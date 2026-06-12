import { useState, useEffect, ReactNode } from "react";
import { useSocket } from "@/context/SocketContext";
import { Ghost, Wifi, WifiOff, ShieldCheck, Crown, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Role = "user" | "owner" | "rm";

export default function JoinPage() {
  const { joinRoom, isConnected } = useSocket();
  const [name, setName]           = useState("");
  const [role, setRole]           = useState<Role>("user");
  const [secret, setSecret]       = useState("");
  const [joining, setJoining]     = useState(false);
  const [showRoles, setShowRoles] = useState(false);

  // Auto-clear secret when going back to user
  useEffect(() => { if (role === "user") setSecret(""); }, [role]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || joining) return;
    setJoining(true);
    joinRoom(name.trim(), role !== "user" ? secret : undefined);
  };

  const roleLabels: Record<Role, { label: string; icon: ReactNode; desc: string }> = {
    user:  { label: "Guest",       icon: <Ghost className="w-4 h-4" />,        desc: "Join as a regular participant" },
    owner: { label: "Owner",       icon: <Crown className="w-4 h-4" />,        desc: "Full room controls (147147)" },
    rm:    { label: "Room Master", icon: <ShieldCheck className="w-4 h-4" />,  desc: "Room master role (1471471)" },
  };

  return (
    <div className="min-h-dvh w-full flex items-center justify-center relative overflow-hidden bg-background">
      {/* Ambient glow orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full
          bg-primary/8 blur-[100px]" />
        <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full
          bg-purple-500/6 blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[300px] h-[300px] rounded-full bg-cyan-500/4 blur-[80px]" />
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-[400px] mx-4">
        <div className="glass-strong rounded-3xl p-8 shadow-2xl">

          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="relative mb-4">
              <div className="w-20 h-20 rounded-2xl bg-primary/15 flex items-center justify-center
                ring-1 ring-primary/20 shadow-[0_0_30px_rgba(139,92,246,0.3)] animate-float-ghost">
                <Ghost className="w-10 h-10 text-primary" />
              </div>
              {/* Connection indicator */}
              <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full border-2 border-background
                flex items-center justify-center
                ${isConnected ? "bg-emerald-500" : "bg-destructive animate-pulse"}`}>
                {isConnected
                  ? <Wifi className="w-2.5 h-2.5 text-white" />
                  : <WifiOff className="w-2.5 h-2.5 text-white" />}
              </div>
            </div>
            <h1 className="font-mono font-black text-3xl tracking-tighter text-foreground">
              GhostRoom
            </h1>
            <p className="text-muted-foreground text-sm mt-1 font-light">
              Enter the void.
            </p>
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            {/* Name input */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Your Name
              </label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Victim #1"
                required
                maxLength={32}
                className="h-12 bg-white/[0.04] border-white/10 focus:border-primary/50
                  focus:ring-0 focus:ring-offset-0 rounded-xl text-base placeholder:text-white/20"
                data-testid="input-name"
              />
            </div>

            {/* Role selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Role
              </label>
              <button
                type="button"
                onClick={() => setShowRoles(p => !p)}
                className="w-full h-12 rounded-xl bg-white/[0.04] border border-white/10
                  flex items-center justify-between px-4 text-sm transition-all
                  hover:bg-white/[0.06] hover:border-white/20"
              >
                <span className="flex items-center gap-2 text-foreground">
                  {roleLabels[role].icon}
                  {roleLabels[role].label}
                </span>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showRoles ? "rotate-180" : ""}`} />
              </button>

              {showRoles && (
                <div className="rounded-xl overflow-hidden border border-white/10 bg-card/80 backdrop-blur-xl animate-slide-up">
                  {(Object.keys(roleLabels) as Role[]).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => { setRole(r); setShowRoles(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm
                        hover:bg-white/5 transition-colors
                        ${role === r ? "bg-primary/10 text-primary" : "text-foreground"}`}
                    >
                      <span className={role === r ? "text-primary" : "text-muted-foreground"}>
                        {roleLabels[r].icon}
                      </span>
                      <div>
                        <p className="font-medium">{roleLabels[r].label}</p>
                        <p className="text-[11px] text-muted-foreground">{roleLabels[r].desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Secret input (animated in for owner/rm) */}
            {role !== "user" && (
              <div className="space-y-1.5 animate-slide-up">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Secret Password
                </label>
                <Input
                  type="password"
                  value={secret}
                  onChange={e => setSecret(e.target.value)}
                  placeholder="Enter secret"
                  required
                  className="h-12 bg-white/[0.04] border-white/10 focus:border-primary/50
                    focus:ring-0 focus:ring-offset-0 rounded-xl text-base"
                  data-testid="input-secret"
                />
              </div>
            )}

            {/* Join button */}
            <Button
              type="submit"
              disabled={!isConnected || !name.trim() || joining}
              className="w-full h-13 rounded-xl font-bold text-base
                bg-gradient-to-r from-primary to-violet-500
                hover:from-primary/90 hover:to-violet-500/90
                shadow-[0_0_20px_rgba(139,92,246,0.4)]
                hover:shadow-[0_0_30px_rgba(139,92,246,0.6)]
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200 text-white"
              style={{ height: "52px" }}
              data-testid="button-join"
            >
              {!isConnected ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Connecting…
                </span>
              ) : joining ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Entering…
                </span>
              ) : (
                "Enter Room →"
              )}
            </Button>
          </form>

          {/* Footer */}
          <p className="text-center text-[11px] text-muted-foreground/40 mt-6 font-mono">
            🔒 End-to-end encrypted · WebRTC · Opus
          </p>
        </div>
      </div>
    </div>
  );
}
