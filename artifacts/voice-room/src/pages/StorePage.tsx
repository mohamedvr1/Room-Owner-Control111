import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Ghost, ShoppingBag, Lock, Unlock, Check, ArrowLeft, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BORDERS, getUnlockedBorders, unlockBorder, getSelectedBorder, setSelectedBorder } from "@/lib/borders";
import { useToast } from "@/hooks/use-toast";

export default function StorePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [selected, setSelected] = useState("default");
  const [buying, setBuying] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [vodafoneNumber, setVodafoneNumber] = useState("01XXXXXXXXX");

  useEffect(() => {
    setUnlocked(getUnlockedBorders());
    setSelected(getSelectedBorder());
    // Fetch Vodafone number from server
    fetch(`${import.meta.env.BASE_URL}api/borders/info`)
      .then(r => r.json())
      .then(d => { if (d.vodafoneNumber) setVodafoneNumber(d.vodafoneNumber); })
      .catch(() => {});
  }, []);

  const handleSelect = (borderId: string) => {
    if (!unlocked.includes(borderId)) return;
    setSelectedBorder(borderId);
    setSelected(borderId);
    toast({ title: "تم اختيار الإطار ✓" });
  };

  const handleVerify = async () => {
    if (!buying || !code.trim()) return;
    setVerifying(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/borders/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), borderType: buying }),
      });
      const data = await res.json() as { valid: boolean; message: string };
      if (data.valid) {
        unlockBorder(buying);
        setUnlocked(getUnlockedBorders());
        setSelectedBorder(buying);
        setSelected(buying);
        setBuying(null);
        setCode("");
        toast({ title: "🎉 " + data.message, description: "تم فتح الإطار الجديد!" });
      } else {
        toast({ title: data.message, variant: "destructive" });
      }
    } catch {
      toast({ title: "خطأ في الاتصال بالسيرفر", variant: "destructive" });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-dvh bg-background relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/8 via-background to-background pointer-events-none" />

      <div className="relative z-10 max-w-2xl mx-auto p-4">
        {/* Header */}
        <div className="flex items-center gap-3 pt-6 pb-8">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> رجوع
          </Button>
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-primary" />
            <h1 className="font-mono font-bold text-xl text-foreground">متجر الإطارات</h1>
          </div>
        </div>

        {/* Payment info banner */}
        <div className="mb-6 p-4 rounded-lg border border-green-500/30 bg-green-950/20 flex gap-3 items-start">
          <Smartphone className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-bold text-green-300 font-mono">الدفع بفودافون كاش</p>
            <p className="text-xs text-green-400/80 mt-1 leading-relaxed">
              ابعت <span className="font-bold text-green-300">20 جنيه</span> على الرقم{" "}
              <span className="font-bold text-green-300 font-mono">{vodafoneNumber}</span>
              {" "}واكتب في الرسالة اسم الإطار اللي عايزه، هتاخد كود فتح في خلال دقائق.
            </p>
          </div>
        </div>

        {/* Borders grid */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          {BORDERS.map(border => {
            const isUnlocked = unlocked.includes(border.id);
            const isSelected = selected === border.id;

            return (
              <div
                key={border.id}
                className={`relative rounded-lg border p-4 transition-all cursor-pointer
                  ${border.cardClass}
                  ${isSelected ? "ring-2 ring-primary/60 scale-[1.02]" : ""}
                  ${!isUnlocked ? "opacity-60" : "hover:scale-[1.02]"}
                `}
                onClick={() => isUnlocked ? handleSelect(border.id) : setBuying(border.id)}
              >
                {/* Lock/check badge */}
                <div className="absolute top-2 right-2">
                  {isSelected ? (
                    <div className="w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-primary-foreground" />
                    </div>
                  ) : isUnlocked ? (
                    <Unlock className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <Lock className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>

                {/* Preview avatar */}
                <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center mb-3 ${border.avatarClass}`}>
                  <Ghost className="w-5 h-5" />
                </div>

                <p className={`font-bold text-sm ${border.textClass}`}>{border.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {border.price === 0 ? "مجاني" : `${border.price} جنيه`}
                </p>

                {!isUnlocked && (
                  <Button size="sm" variant="outline"
                    className="w-full mt-3 h-7 text-xs border-border/50"
                    onClick={e => { e.stopPropagation(); setBuying(border.id); }}>
                    شراء
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* Active selection indicator */}
        <p className="text-center text-xs text-muted-foreground font-mono mb-8">
          الإطار المختار حالياً: <span className="text-foreground">{BORDERS.find(b => b.id === selected)?.name}</span>
        </p>
      </div>

      {/* Code entry modal */}
      {buying && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="text-center">
              <Ghost className="w-8 h-8 text-primary mx-auto mb-2" />
              <h2 className="font-mono font-bold text-foreground">
                {BORDERS.find(b => b.id === buying)?.name}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">السعر: 20 جنيه</p>
            </div>

            <div className="p-3 rounded-lg border border-green-500/30 bg-green-950/20 text-xs text-green-400/80 space-y-1">
              <p className="font-bold text-green-300">خطوات الدفع:</p>
              <p>١. ابعت 20 جنيه على: <span className="font-mono text-green-300">{vodafoneNumber}</span></p>
              <p>٢. اكتب في الرسالة: <span className="font-mono text-green-300">{buying}</span></p>
              <p>٣. هتاخد كود الفتح في الرسائل</p>
            </div>

            <div className="space-y-2">
              <Input
                placeholder="أدخل كود الفتح"
                value={code}
                onChange={e => setCode(e.target.value)}
                className="bg-background border-border/50 text-center font-mono tracking-widest uppercase"
                onKeyDown={e => { if (e.key === "Enter") handleVerify(); }}
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setBuying(null); setCode(""); }}>
                إلغاء
              </Button>
              <Button className="flex-1" disabled={!code.trim() || verifying} onClick={handleVerify}>
                {verifying ? "جاري التحقق..." : "تفعيل"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
