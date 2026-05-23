import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Ghost, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { unlockBorder, setSelectedBorder, getBorderById } from "@/lib/borders";

type Status = "loading" | "success" | "error";

export default function UnlockPage() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<Status>("loading");
  const [borderName, setBorderName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const border = params.get("border");
    const code = params.get("code");
    const error = params.get("error");

    if (error) {
      const msgs: Record<string, string> = {
        payment_failed: "فشلت عملية الدفع، لم يتم خصم أي مبلغ.",
        invalid_hmac: "فشل التحقق الأمني من الدفع.",
        order_not_found: "لم يتم العثور على الطلب، تواصل مع الدعم.",
      };
      setErrorMsg(msgs[error] || "حدث خطأ غير متوقع.");
      setStatus("error");
      return;
    }

    if (!border || !code) {
      setErrorMsg("رابط غير صالح.");
      setStatus("error");
      return;
    }

    // Unlock the border locally and confirm with server
    unlockBorder(border);
    setSelectedBorder(border);
    const b = getBorderById(border);
    setBorderName(b.name);

    fetch(`${import.meta.env.BASE_URL}api/payment/confirm-unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ borderType: border, code }),
    }).catch(() => {}); // best-effort

    setStatus("success");

    // Auto-redirect to store after 4 seconds
    const timer = setTimeout(() => setLocation("/store"), 4000);
    return () => clearTimeout(timer);
  }, [setLocation]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <div className="text-center max-w-sm w-full space-y-6">
        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 text-primary mx-auto animate-spin" />
            <p className="text-muted-foreground font-mono">جاري التحقق من الدفع...</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="relative inline-block">
              <Ghost className="w-16 h-16 text-primary mx-auto" />
              <CheckCircle className="w-6 h-6 text-green-400 absolute -bottom-1 -right-1" />
            </div>
            <div>
              <h1 className="font-mono font-bold text-2xl text-foreground">تم الدفع!</h1>
              <p className="text-muted-foreground mt-2">
                إطار <span className="text-foreground font-bold">{borderName}</span> اتفتح تلقائياً
              </p>
            </div>
            <div className="bg-green-950/30 border border-green-500/30 rounded-lg p-4">
              <p className="text-sm text-green-400">✓ تم إضافة الإطار لحسابك</p>
              <p className="text-xs text-muted-foreground mt-1">هيتحول للمتجر تلقائياً...</p>
            </div>
            <Button onClick={() => setLocation("/store")} className="w-full">
              الذهاب للمتجر
            </Button>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="w-16 h-16 text-destructive mx-auto" />
            <div>
              <h1 className="font-mono font-bold text-2xl text-foreground">حدث خطأ</h1>
              <p className="text-muted-foreground mt-2">{errorMsg}</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setLocation("/store")}>
                العودة للمتجر
              </Button>
              <Button className="flex-1" onClick={() => history.back()}>
                حاول مرة أخرى
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
