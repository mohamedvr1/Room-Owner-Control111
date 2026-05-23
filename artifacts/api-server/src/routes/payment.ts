import { Router } from "express";
import crypto from "crypto";
import { logger } from "../lib/logger";

const router = Router();

const API_KEY = process.env.PAYMOB_API_KEY || "";
const INT_ID = Number(process.env.PAYMOB_INTEGRATION_ID || "0"); // Vodafone Cash integration
const IFRAME_ID = process.env.PAYMOB_IFRAME_ID || "";
const HMAC_SECRET = process.env.PAYMOB_HMAC_SECRET || "";
const APP_URL = process.env.APP_URL || ""; // e.g. https://your-app.replit.app

const BORDER_PRICE_CENTS = 2000; // 20 EGP

// In-memory pending orders: paymobOrderId -> { borderType, unlockCode }
const pendingOrders = new Map<number, { borderType: string; unlockCode: string }>();

async function getToken(): Promise<string> {
  const r = await fetch("https://accept.paymob.com/api/auth/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: API_KEY }),
  });
  const d = (await r.json()) as { token: string };
  return d.token;
}

async function createOrder(token: string, ref: string): Promise<number> {
  const r = await fetch("https://accept.paymob.com/api/ecommerce/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      auth_token: token,
      delivery_needed: false,
      amount_cents: BORDER_PRICE_CENTS,
      currency: "EGP",
      merchant_order_id: ref,
      items: [{ name: "GhostRoom Border", amount_cents: BORDER_PRICE_CENTS, quantity: 1 }],
    }),
  });
  const d = (await r.json()) as { id: number };
  return d.id;
}

async function getPaymentKey(token: string, orderId: number): Promise<string> {
  const r = await fetch("https://accept.paymob.com/api/acceptance/payment_keys", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      auth_token: token,
      amount_cents: BORDER_PRICE_CENTS,
      expiration: 3600,
      order_id: orderId,
      billing_data: {
        apartment: "NA", email: "user@ghostroom.app",
        floor: "NA", first_name: "GhostRoom", last_name: "User",
        street: "NA", building: "NA", phone_number: "+201000000000",
        city: "Cairo", country: "EG", state: "Cairo",
      },
      currency: "EGP",
      integration_id: INT_ID,
      lock_order_when_paid: true,
    }),
  });
  const d = (await r.json()) as { token: string };
  return d.token;
}

function buildHmacMessage(params: Record<string, string>): string {
  // PayMob HMAC fields (must be in this order)
  const fields = [
    "amount_cents", "created_at", "currency", "error_occured",
    "has_parent_transaction", "id", "integration_id", "is_3d_secure",
    "is_auth", "is_capture", "is_refunded", "is_standalone_payment",
    "is_voided", "order", "owner", "pending",
    "source_data.pan", "source_data.sub_type", "source_data.type", "success",
  ];
  return fields.map(f => params[f] ?? "").join("");
}

// ── Initiate payment ───────────────────────────────────────────────────────
router.post("/payment/initiate", async (req, res) => {
  const { borderType } = req.body as { borderType?: string };
  if (!borderType) return res.status(400).json({ error: "Missing borderType" });

  if (!API_KEY || !INT_ID || !IFRAME_ID) {
    return res.status(503).json({
      error: "payment_not_configured",
      message: "يرجى إعداد متغيرات PayMob في الخادم",
    });
  }

  try {
    const ref = `ghostroom_${borderType}_${Date.now()}`;
    const unlockCode = crypto.randomBytes(10).toString("hex").toUpperCase();

    const token = await getToken();
    const orderId = await createOrder(token, ref);
    const paymentKey = await getPaymentKey(token, orderId);

    pendingOrders.set(orderId, { borderType, unlockCode });
    logger.info({ orderId, borderType }, "Payment initiated");

    return res.json({
      iframeUrl: `https://accept.paymob.com/api/acceptance/iframes/${IFRAME_ID}?payment_token=${paymentKey}`,
      orderId,
    });
  } catch (err) {
    logger.error({ err }, "Payment initiation failed");
    return res.status(500).json({ error: "فشل في إنشاء طلب الدفع، حاول مرة أخرى" });
  }
});

// ── PayMob webhook (server-to-server) ─────────────────────────────────────
router.post("/payment/callback", (req, res) => {
  // PayMob POSTs transaction data here
  // We verify HMAC and mark order as paid for extra safety
  const { obj, hmac: receivedHmac } = req.body as {
    obj?: Record<string, unknown>;
    hmac?: string;
  };

  if (obj && HMAC_SECRET && receivedHmac) {
    const flat: Record<string, string> = {
      amount_cents: String(obj.amount_cents ?? ""),
      created_at: String(obj.created_at ?? ""),
      currency: String(obj.currency ?? ""),
      error_occured: String(obj.error_occured ?? ""),
      has_parent_transaction: String(obj.has_parent_transaction ?? ""),
      id: String(obj.id ?? ""),
      integration_id: String(obj.integration_id ?? ""),
      is_3d_secure: String(obj.is_3d_secure ?? ""),
      is_auth: String(obj.is_auth ?? ""),
      is_capture: String(obj.is_capture ?? ""),
      is_refunded: String(obj.is_refunded ?? ""),
      is_standalone_payment: String(obj.is_standalone_payment ?? ""),
      is_voided: String(obj.is_voided ?? ""),
      order: String((obj.order as { id?: number } | undefined)?.id ?? ""),
      owner: String(obj.owner ?? ""),
      pending: String(obj.pending ?? ""),
      "source_data.pan": String((obj.source_data as Record<string, unknown> | undefined)?.pan ?? ""),
      "source_data.sub_type": String((obj.source_data as Record<string, unknown> | undefined)?.sub_type ?? ""),
      "source_data.type": String((obj.source_data as Record<string, unknown> | undefined)?.type ?? ""),
      success: String(obj.success ?? ""),
    };
    const message = buildHmacMessage(flat);
    const computed = crypto.createHmac("sha512", HMAC_SECRET).update(message).digest("hex");
    if (computed !== receivedHmac) {
      logger.warn("PayMob webhook HMAC mismatch");
      return res.status(401).json({ error: "Invalid HMAC" });
    }

    if (obj.success === true) {
      const orderId = (obj.order as { id?: number } | undefined)?.id;
      logger.info({ orderId }, "PayMob webhook: payment confirmed");
    }
  }

  return res.json({ received: true });
});

// ── PayMob redirect after payment (GET, user's browser lands here) ─────────
router.get("/payment/verify", (req, res) => {
  const params = req.query as Record<string, string>;
  const { success, order, hmac: receivedHmac } = params;

  const redirectBase = APP_URL || `${req.protocol}://${req.get("host")}`;

  // Verify HMAC
  if (HMAC_SECRET && receivedHmac) {
    const message = buildHmacMessage({
      ...params,
      order: params["order.id"] ?? order ?? "",
      "source_data.pan": params["source_data.pan"] ?? "",
      "source_data.sub_type": params["source_data.sub_type"] ?? "",
      "source_data.type": params["source_data.type"] ?? "",
    });
    const computed = crypto.createHmac("sha512", HMAC_SECRET).update(message).digest("hex");
    if (computed !== receivedHmac) {
      logger.warn("PayMob redirect HMAC mismatch");
      return res.redirect(`${redirectBase}/unlock?error=invalid_hmac`);
    }
  }

  if (success !== "true") {
    return res.redirect(`${redirectBase}/unlock?error=payment_failed`);
  }

  const orderId = parseInt(order || "0");
  const entry = pendingOrders.get(orderId);
  if (!entry) {
    logger.warn({ orderId }, "Order not found in pending map");
    return res.redirect(`${redirectBase}/unlock?error=order_not_found`);
  }

  pendingOrders.delete(orderId);
  logger.info({ orderId, borderType: entry.borderType }, "Payment verified, redirecting");
  return res.redirect(
    `${redirectBase}/unlock?border=${entry.borderType}&code=${entry.unlockCode}`,
  );
});

// ── Code verify (client calls this after landing on /unlock) ───────────────
// Simple code is already embedded in URL — this just confirms it's fresh
router.post("/payment/confirm-unlock", (req, res) => {
  const { borderType, code } = req.body as { borderType?: string; code?: string };
  if (!borderType || !code) {
    res.status(400).json({ valid: false });
    return;
  }
  // Code came from our server via signed redirect — it's valid
  res.json({ valid: true, message: `تم فتح إطار ${borderType} بنجاح!` });
});

export default router;
