import { useState, useEffect, useRef } from "react";
import { useSocket } from "@/context/SocketContext";
import { Ghost, Wifi, WifiOff, Crown, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";

const LS_NAME   = "gr_name";
const LS_SECRET = "gr_secret";

export default function JoinPage() {
  const { registerUser, isConnected, myName } = useSocket();
  const [, setLocation] = useLocation();

  const [name, setName]               = useState("");
  const [joining, setJoining]         = useState(false);
  const [showAuthDrawer, setShowAuthDrawer] = useState(false);
  const [secretInput, setSecretInput] = useState("");
  const [savedSecret, setSavedSecret] = useState("");
  const [savedRole, setSavedRole]     = useState<"owner" | "rm" | "">("");

  // Tap counter for hidden auth
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Load from localStorage
  useEffect(() => {
    const savedName = localStorage.getItem(LS_NAME) ?? "";
    const secret    = localStorage.getItem(LS_SECRET) ?? "";
    setName(savedName);
    setSavedSecret(secret);
    if (secret === "147147")  setSavedRole("owner");
    if (secret === "1471471") setSavedRole("rm");
  }, []);

  // If already registered, go to lobby
  useEffect(() => {
    if (myName) setLocation("/lobby");
  }, [myName, setLocation]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || joining || !isConnected) return;
    setJoining(true);
    localStorage.setItem(LS_NAME, name.trim());
    registerUser(name.trim(), savedSecret || undefined);
  };

  // ── Hidden auth: 5 rapid taps on ghost logo ─────────────────────────────
  const handleGhostTap = () => {
    tapCountRef.current += 1;
    clearTimeout(tapTimerRef.current);
    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0;
      setShowAuthDrawer(true);
      return;
    }
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 2500);
  };

  const saveSecret = () => {
    const s = secretInput.trim();
    localStorage.setItem(LS_SECRET, s);
    setSavedSecret(s);
    if (s === "147147")  setSavedRole("owner");
    else if (s === "1471471") setSavedRole("rm");
    else setSavedRole("");
    setSecretInput("");
    setShowAuthDrawer(false);
  };

  const clearSecret = () => {
    localStorage.removeItem(LS_SECRET);
    setSavedSecret(""); setSavedRole(""); setSecretInput("");
    setShowAuthDrawer(false);
  };

  return (
    <div className="min-h-dvh w-full flex items-center justify-center relative overflow-hidden bg-background">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-primary/8 blur-[100px]" />
        <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full bg-violet-500/6 blur-[120px]" />
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-[400px] mx-4">
        <div className="glass-strong rounded-3xl p-8 shadow-2xl">

          {/* Logo — tap 5× to unlock hidden auth */}
          <div className="flex flex-col items-center mb-8">
            <div className="relative mb-4">
              <button
                type="button"
                onClick={handleGhostTap}
                className="w-20 h-20 rounded-2xl bg-primary/15 flex items-center justify-center
                  ring-1 ring-primary/20 shadow-[0_0_30px_rgba(139,92,246,0.3)] animate-float-ghost
                  active:scale-95 transition-transform select-none"
              >
                <Ghost className="w-10 h-10 text-primary pointer-events-none" />
              </button>

              {/* Connection indicator */}
              <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full border-2 border-background
                flex items-center justify-center
                ${isConnected ? "bg-emerald-500" : "bg-destructive animate-pulse"}`}>
                {isConnected ? <Wifi className="w-2.5 h-2.5 text-white" /> : <WifiOff className="w-2.5 h-2.5 text-white" />}
              </div>

              {/* Role badge (subtle, visible only to authenticated user) */}
              {savedRole === "owner" && (
                <div className="absolute -bottom-1 -left-1 w-5 h-5 rounded-full bg-amber-500
                  flex items-center justify-center ring-2 ring-background" title="Owner">
                  <Crown className="w-3 h-3 text-white" />
                </div>
              )}
              {savedRole === "rm" && (
                <div className="absolute -bottom-1 -left-1 w-5 h-5 rounded-full bg-pink-500
                  flex items-center justify-center ring-2 ring-background" title="Room Master">
                  <Shield className="w-3 h-3 text-white" />
                </div>
              )}
            </div>

            <h1 className="font-mono font-black text-3xl tracking-tighter text-foreground">GhostRoom</h1>
            <p className="text-muted-foreground text-sm mt-1 font-light">Enter the void.</p>
          </div>

          {/* Form */}
          <form onSubmit={handleJoin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Name</label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Victim #1"
                required maxLength={32}
                className="h-12 bg-white/[0.04] border-white/10 focus:border-primary/50 rounded-xl text-base placeholder:text-white/20"
              />
            </div>

            <Button
              type="submit"
              disabled={!isConnected || !name.trim() || joining}
              className="w-full rounded-xl font-bold text-base bg-gradient-to-r from-primary to-violet-500
                hover:from-primary/90 hover:to-violet-500/90
                shadow-[0_0_20px_rgba(139,92,246,0.4)] hover:shadow-[0_0_30px_rgba(139,92,246,0.6)]
                disabled:opacity-50 text-white transition-all duration-200"
              style={{ height: 52 }}
            >
              {joining ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Entering…
                </span>
              ) : !isConnected ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Connecting…
                </span>
              ) : "Enter Room →"}
            </Button>
          </form>

          <p className="text-center text-[11px] text-muted-foreground/40 mt-6 font-mono">
            🔒 End-to-end encrypted · WebRTC · Opus
          </p>
        </div>
      </div>

      {/* ── Hidden auth drawer ───────────────────────────────────────────── */}
      {showAuthDrawer && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowAuthDrawer(false)}>
          <div
            className="glass-strong border-t border-white/10 rounded-t-3xl p-6 shadow-2xl animate-slide-up max-w-md mx-auto w-full"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-5" />
            <h2 className="text-base font-mono font-bold text-foreground mb-1">Secret Access</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {savedRole
                ? `Currently authenticated as: ${savedRole === "owner" ? "Owner 👑" : "Room Master 🛡️"}`
                : "Enter your secret code to unlock special access."}
            </p>

            <div className="space-y-3">
              <Input
                type="password"
                value={secretInput}
                onChange={e => setSecretInput(e.target.value)}
                placeholder="Secret code"
                className="h-11 bg-white/[0.04] border-white/10 rounded-xl"
                onKeyDown={e => e.key === "Enter" && saveSecret()}
                autoFocus
              />
              <div className="flex gap-2">
                <Button onClick={saveSecret} className="flex-1 h-10 text-sm bg-primary/80 hover:bg-primary rounded-xl text-white">
                  Confirm
                </Button>
                {savedRole && (
                  <Button onClick={clearSecret} variant="outline"
                    className="flex-1 h-10 text-sm border-white/10 rounded-xl text-destructive hover:bg-destructive/10">
                    Clear Auth
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
