import { useEffect, useState, useRef } from "react";
import { useSocket, RoomInfo } from "@/context/SocketContext";
import { useLocation } from "wouter";
import {
  Ghost, Plus, Crown, Shield, Clock, Users, RefreshCw,
  Wallet, X, ChevronRight, UserCheck, CircleDollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function timeLeft(expiresAt: number): string {
  const diff = Math.max(0, expiresAt - Date.now());
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function LobbyPage() {
  const {
    myName, isOwner, isRM, credits, rooms, isConnected,
    refreshRooms, createRoom, joinVoiceRoom,
    addCredits, getUsers, userList,
    lastRoomError, clearRoomError,
  } = useSocket();

  const [, setLocation]          = useLocation();
  const [showCreate, setShowCreate] = useState(false);
  const [roomName, setRoomName]  = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminTab, setAdminTab]  = useState<"add" | "users">("add");
  const [targetName, setTargetName] = useState("");
  const [creditAmt, setCreditAmt]   = useState("1");
  const [showNoCredits, setShowNoCredits] = useState(false);
  const [tick, setTick]          = useState(0); // for countdown refresh

  // Redirect to join if not registered
  useEffect(() => { if (!myName) setLocation("/"); }, [myName, setLocation]);

  // Load rooms + tick countdown every 30s
  useEffect(() => {
    refreshRooms();
    const id = setInterval(() => { setTick(t => t + 1); refreshRooms(); }, 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect NO_CREDITS error
  useEffect(() => {
    if (lastRoomError === "NO_CREDITS") {
      setShowNoCredits(true);
      clearRoomError();
    }
  }, [lastRoomError, clearRoomError]);

  const handleCreateRoom = () => {
    if (!roomName.trim()) return;
    createRoom(roomName.trim());
    setRoomName("");
    setShowCreate(false);
  };

  const handleAddCredits = () => {
    const amt = parseInt(creditAmt);
    if (!targetName.trim() || isNaN(amt) || amt < 1) return;
    addCredits(targetName.trim(), amt);
    setTargetName(""); setCreditAmt("1");
  };

  const openAdmin = () => { setShowAdmin(true); getUsers(); };

  const privileged = isOwner || isRM;
  // Unused tick suppression
  void tick;

  return (
    <div className="min-h-dvh flex flex-col bg-background relative overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[250px] bg-primary/5 blur-[80px] rounded-full" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-5 py-4
        border-b border-white/6 bg-background/70 backdrop-blur-xl sticky top-0">
        <div className="flex items-center gap-2.5">
          <Ghost className="w-5 h-5 text-primary" />
          <span className="font-mono font-bold text-lg tracking-tight">GhostRoom</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Role badge */}
          {isOwner && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono
              bg-amber-500/15 text-amber-300 border border-amber-400/20">
              <Crown className="w-3 h-3" /> Owner
            </span>
          )}
          {isRM && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono
              bg-pink-500/15 text-pink-300 border border-pink-400/20">
              <Shield className="w-3 h-3" /> RM
            </span>
          )}

          {/* Credits badge (guests only) */}
          {!privileged && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono
              bg-white/5 text-muted-foreground border border-white/10">
              <Wallet className="w-3 h-3" /> {credits} credit{credits !== 1 ? "s" : ""}
            </span>
          )}

          {/* Admin panel button (owner only) */}
          {isOwner && (
            <button onClick={openAdmin}
              className="w-8 h-8 rounded-xl glass flex items-center justify-center
                text-amber-300/60 hover:text-amber-300 transition-colors">
              <CircleDollarSign className="w-4 h-4" />
            </button>
          )}

          <button onClick={refreshRooms}
            className="w-8 h-8 rounded-xl glass flex items-center justify-center
              text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* User greeting */}
      <div className="relative z-10 px-5 pt-4 pb-2">
        <p className="text-muted-foreground text-sm">
          Welcome, <span className="text-foreground font-semibold">{myName}</span>
          {!isConnected && <span className="text-destructive/70 text-xs ml-2">(reconnecting…)</span>}
        </p>
      </div>

      {/* Room list */}
      <main className="flex-1 relative z-10 px-4 pb-28 overflow-y-auto">
        {rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Ghost className="w-14 h-14 text-white/10 animate-float-ghost" />
            <p className="text-muted-foreground/50 font-mono text-sm text-center">
              No active rooms.<br />Create one to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-2 mt-2">
            {rooms.map(room => (
              <RoomCard
                key={room.id}
                room={room}
                onJoin={() => joinVoiceRoom(room.id)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Create room FAB */}
      <div className="fixed bottom-6 left-0 right-0 z-20 flex justify-center px-4">
        <button
          onClick={() => {
            if (!privileged && credits < 1) { setShowNoCredits(true); return; }
            setShowCreate(true);
          }}
          className="flex items-center gap-2 px-6 h-14 rounded-2xl font-bold text-sm
            bg-gradient-to-r from-primary to-violet-500 text-white
            shadow-[0_0_24px_rgba(139,92,246,0.5)] hover:shadow-[0_0_36px_rgba(139,92,246,0.7)]
            transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" />
          Create Room
          {!privileged && credits > 0 && (
            <span className="text-xs opacity-70 font-normal">(1 credit)</span>
          )}
        </button>
      </div>

      {/* ── Create room modal ───────────────────────────────────────────── */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} title="New Room">
          <div className="space-y-3">
            <Input
              value={roomName}
              onChange={e => setRoomName(e.target.value)}
              placeholder="Room name…"
              className="h-11 bg-white/[0.04] border-white/10 rounded-xl"
              onKeyDown={e => e.key === "Enter" && handleCreateRoom()}
              autoFocus maxLength={48}
            />
            <p className="text-xs text-muted-foreground">
              Room stays active for <strong>24 hours</strong> then auto-expires.
              {!privileged && ` (costs 1 credit)`}
            </p>
            <div className="flex gap-2">
              <Button onClick={() => setShowCreate(false)} variant="outline"
                className="flex-1 h-10 border-white/10 rounded-xl text-sm">Cancel</Button>
              <Button onClick={handleCreateRoom} disabled={!roomName.trim()}
                className="flex-1 h-10 bg-primary rounded-xl text-sm text-white">Create</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── No credits modal ─────────────────────────────────────────────── */}
      {showNoCredits && (
        <Modal onClose={() => setShowNoCredits(false)} title="Need Credits 💳">
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>You need <strong className="text-foreground">credits</strong> to create a room.</p>
            <div className="glass rounded-xl p-4 space-y-1">
              <p className="font-medium text-foreground text-sm">How to get credits:</p>
              <p>1. Send payment via <strong className="text-foreground">Vodafone Cash</strong></p>
              <p className="font-mono text-primary text-base font-bold">01026703525</p>
              <p>2. Tell the room owner your <strong className="text-foreground">username: {myName}</strong></p>
              <p>3. Credits will appear in your account automatically.</p>
            </div>
            <Button onClick={() => setShowNoCredits(false)} className="w-full h-10 bg-primary rounded-xl text-white text-sm">
              Got it
            </Button>
          </div>
        </Modal>
      )}

      {/* ── Owner admin panel ─────────────────────────────────────────────── */}
      {showAdmin && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowAdmin(false)}>
          <div className="glass-strong border-t border-white/10 rounded-t-3xl p-5 shadow-2xl animate-slide-up max-h-[80vh] overflow-hidden"
            style={{ maxWidth: 480, margin: "0 auto", width: "100%" }}
            onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" />

            <div className="flex items-center justify-between mb-4">
              <h2 className="font-mono font-bold text-foreground flex items-center gap-2">
                <Crown className="w-4 h-4 text-amber-400" /> Owner Panel
              </h2>
              <button onClick={() => setShowAdmin(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex rounded-xl overflow-hidden border border-white/10 mb-4">
              {(["add", "users"] as const).map(tab => (
                <button key={tab} onClick={() => { setAdminTab(tab); if (tab === "users") getUsers(); }}
                  className={`flex-1 py-2 text-sm font-medium transition-colors
                    ${adminTab === tab ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                  {tab === "add" ? "Add Credits" : "Users List"}
                </button>
              ))}
            </div>

            {adminTab === "add" && (
              <div className="space-y-3">
                <Input value={targetName} onChange={e => setTargetName(e.target.value)}
                  placeholder="Username" className="h-11 bg-white/[0.04] border-white/10 rounded-xl" />
                <div className="flex gap-2">
                  <Input value={creditAmt} onChange={e => setCreditAmt(e.target.value)}
                    type="number" min="1" max="1000" placeholder="Amount"
                    className="h-11 bg-white/[0.04] border-white/10 rounded-xl w-24 flex-shrink-0" />
                  <Button onClick={handleAddCredits} disabled={!targetName.trim()}
                    className="flex-1 h-11 bg-primary rounded-xl text-white text-sm">
                    Add Credits
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground/60">
                  Credits allow guests to create rooms (1 credit = 1 room).
                </p>
              </div>
            )}

            {adminTab === "users" && (
              <div className="space-y-1.5 max-h-[35vh] overflow-y-auto">
                {userList.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-4">No registered users yet.</p>
                ) : userList.map(u => (
                  <div key={u.name} className="flex items-center justify-between glass rounded-xl px-3 py-2">
                    <div className="flex items-center gap-2">
                      <UserCheck className={`w-4 h-4 ${u.online ? "text-emerald-400" : "text-muted-foreground"}`} />
                      <span className="text-sm font-medium text-foreground">{u.name}</span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">{u.credits} credits</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function RoomCard({ room, onJoin }: { room: RoomInfo; onJoin: () => void }) {
  return (
    <div className="glass rounded-2xl p-4 flex items-center justify-between gap-3 animate-slide-up
      hover:bg-white/[0.06] transition-colors group cursor-pointer" onClick={onJoin}>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-foreground truncate">{room.displayName}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Users className="w-3 h-3" /> {room.participantCount}
          </span>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" /> {timeLeft(room.expiresAt)}
          </span>
          <span className="text-xs text-muted-foreground truncate">by {room.createdBy}</span>
        </div>
      </div>
      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
    </div>
  );
}

function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="glass-strong rounded-3xl p-6 w-full max-w-md shadow-2xl animate-slide-up"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-mono font-bold text-lg text-foreground">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
