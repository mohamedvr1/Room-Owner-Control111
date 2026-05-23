import { Router } from "express";

const router = Router();

const VODAFONE_NUMBER = process.env.VODAFONE_CASH_NUMBER || "01XXXXXXXXX";

const BORDER_CODES: Record<string, string> = {
  crimson: process.env.BORDER_CODE_CRIMSON || "CRIMSON2025",
  sapphire: process.env.BORDER_CODE_SAPPHIRE || "SAPPHIRE2025",
  emerald: process.env.BORDER_CODE_EMERALD || "EMERALD2025",
  violet: process.env.BORDER_CODE_VIOLET || "VIOLET2025",
  orange: process.env.BORDER_CODE_ORANGE || "ORANGE2025",
};

router.get("/borders/info", (_req, res) => {
  res.json({ vodafoneNumber: VODAFONE_NUMBER });
});

router.post("/borders/verify", (req, res) => {
  const { code, borderType } = req.body as { code?: string; borderType?: string };

  if (!code || !borderType) {
    return res.status(400).json({ valid: false, message: "Missing code or borderType" });
  }

  const expected = BORDER_CODES[borderType];
  if (!expected) {
    return res.status(400).json({ valid: false, message: "Unknown border type" });
  }

  const valid = code.trim().toUpperCase() === expected.toUpperCase();
  return res.json({ valid, message: valid ? "تم فتح الإطار بنجاح!" : "الكود غير صحيح" });
});

export default router;
