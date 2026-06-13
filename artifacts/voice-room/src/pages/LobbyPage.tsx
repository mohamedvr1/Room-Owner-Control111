import { useEffect, useState } from "react";
import { useSocket, RoomInfo } from "@/context/SocketContext";
import { useLocation } from "wouter";
import {
  Ghost, Plus, Crown, Shield, Clock, Users, RefreshCw, Wallet, X,
  ChevronRight, UserCheck, CircleDollarSign, Lock, Eye, EyeOff,
  Key, Trash2, ShieldCheck, Infinity as InfinityIcon, PlusCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const FOREVER = Number.MAX_SAFE_INTEGER;

function timeLeft(expiresAt: number): string {
  if (expiresAt >= FOREVER - 1_000_000) return "∞";
  const diff = Math.max(0, expiresAt - Date.now());
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)}d`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function LobbyPage() {
  const {
    myName, isOwner, isRM, credits, rooms, isConnected,
    refreshRooms, createRoom, joinVoiceRoom, ownerDeleteRoom, extendRoomTime,
    addCredits, getUsers, userList,
    lastRoomError, clearRoomError,
    isStealthMode, toggleStealth,
  } = useSocket();

  const [, setLocation] = useLocation();

  const [showCreate, setShowCreate]     = useState(false);
  const [roomName, setRoomName]         = useState("");
  const [roomPassword, setRoomPassword] = useState("");
  const [showRoomPw, setShowRoomPw]     = useState(false);

  const [showAdmin, setShowAdmin]       = useState(false);
  const [adminTab, setAdminTab]         = useState<"add" | "users" | "rooms">("add");
  const [targetName, setTargetName]     = useState("");
  const [creditAmt, setCreditAmt]       = useState("20");

  const [joinTarget, setJoinTarget]     = useState<RoomInfo | null>(null);
  const [joinPassword, setJoinPassword] = useState("");
  const [showJoinPw, setShowJoinPw]     = useState(false);
  const [joinPwError, setJoinPwError]   = useState(false);

  const [showNoCredits, setShowNoCredits] = useState(false);

  useEffect(() => { if (!myName) setLocation("/"); }, [myName, setLocation]);
  useEffect(() => {
    refreshRooms();
    const id = setInterval(refreshRooms, 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!lastRoomError) return;
    if (lastRoomError === "NO_CREDITS")    { setShowNoCredits(true); clearRoomError(); }
    else if (lastRoomError === "WRONG_PASSWORD") { setJoinPwError(true); clearRoomError(); }
  }, [lastRoomError, clearRoomError]);

  const privileged = isOwner || isRM;

  const handleCreateRoom = () => {
    if (!roomName.trim()) return;
    createRoom(roomName.trim(), roomPassword.trim() || undefined);
    setRoomName(""); setRoomPassword(""); setShowCreate(false);
  };

  const handleAddCredits = () => {
    const amt = parseInt(creditAmt);
    if (!targetName.trim() || isNaN(amt) || amt < 1) return;
    addCredits(targetName.trim(), amt);
    setTargetName(""); setCreditAmt("20");
  };

  const canExtend = (room: RoomInfo) =>
    (isOwner || room.createdBy === myName) && !room.isPermanent;

  const handleRoomClick = (room: RoomInfo) => {
    if (room.hasPassword && !isOwner) {
      setJoinTarget(room); setJoinPassword(""); setJoinPwError(false);
    } else {
      joinVoiceRoom(room.id, undefined, isStealthMode);
    }
  };

  const handleJoinWithPassword = () => {
    if (!joinTarget) return;
    setJoinPwError(false);
    joinVoiceRoom(joinTarget.id, joinPassword.trim(), isStealthMode);
  };

  const openAdmin = () => { setShowAdmin(true); getUsers(); };

  // Sort: permanent first, then by participant count
  const sortedRooms = [...rooms].sort((a, b) => {
    if (a.isPermanent && !b.isPermanent) return -1;
    if (!a.isPermanent && b.isPermanent) return 1;
    return b.participantCount - a.participantCount;
  });

  return (
    <div className="min-h-dvh flex flex-col bg-background relative overflow-hidden">
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
          {!privileged && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono
              bg-white/5 text-muted-foreground border border-white/10">
              <Wallet className="w-3 h-3" /> {credits} cr
            </span>
          )}
          {isOwner && (
            <button onClick={openAdmin}
              className="w-8 h-8 rounded-xl glass flex items-center justify-center
                text-amber-300/50 hover:text-amber-300 transition-colors">
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

      {/* Greeting + stealth indicator */}
      <div className="relative z-10 px-5 pt-4 pb-1 flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          Welcome, <span className="text-foreground font-semibold">{myName}</span>
          {!isConnected && <span className="text-destructive/70 text-xs ml-2">(reconnecting…)</span>}
        </p>
        {isStealthMode && (
          <span className="flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full
            bg-slate-500/20 text-slate-300 border border-slate-400/20 animate-pulse">
            <EyeOff className="w-3 h-3" /> Stealth
          </span>
        )}
      </div>

      {/* Room list */}
      <main className="flex-1 relative z-10 px-4 pb-28 overflow-y-auto">
        {sortedRooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Ghost className="w-14 h-14 text-white/10 animate-float-ghost" />
            <p className="text-muted-foreground/50 font-mono text-sm text-center">
              No active rooms.<br />Create one to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-2 mt-3">
            {sortedRooms.map(room => (
              <RoomCard key={room.id} room={room}
                myName={myName} isOwner={isOwner}
                canExtend={canExtend(room)}
                onJoin={() => handleRoomClick(room)}
                onExtend={() => extendRoomTime(room.id, 24)}
                onDelete={() => ownerDeleteRoom(room.id)} />
            ))}
          </div>
        )}
      </main>

      {/* FAB row */}
      <div className="fixed bottom-6 left-0 right-0 z-20 flex justify-center gap-3 px-4">
        {isOwner && (
          <button onClick={toggleStealth}
            className={`flex items-center gap-2 px-4 h-14 rounded-2xl font-semibold text-sm
              border transition-all active:scale-95
              ${isStealthMode
                ? "bg-slate-700 border-slate-500/60 text-slate-200 shadow-[0_0_16px_rgba(100,116,139,0.4)]"
                : "glass border-white/10 text-muted-foreground hover:text-foreground"}`}>
            {isStealthMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            <span className="hidden sm:inline">Stealth</span>
          </button>
        )}

        <button
          onClick={() => {
            if (!privileged && credits < 20) { setShowNoCredits(true); return; }
            setShowCreate(true);
          }}
          className="flex items-center gap-2 px-6 h-14 rounded-2xl font-bold text-sm
            bg-gradient-to-r from-primary to-violet-500 text-white
            shadow-[0_0_24px_rgba(139,92,246,0.5)] hover:shadow-[0_0_36px_rgba(139,92,246,0.7)]
            transition-all active:scale-95">
          <Plus className="w-5 h-5" />
          Create Room
          {!privileged && (
            <span className="text-xs opacity-70 font-normal">(20 cr)</span>
          )}
        </button>
      </div>

      {/* ── Create room modal ──────────────────────────────────────────────── */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} title="New Room">
          <div className="space-y-3">
            <Input value={roomName} onChange={e => setRoomName(e.target.value)}
              placeholder="Room name…" autoFocus maxLength={48}
              className="h-11 bg-white/[0.04] border-white/10 rounded-xl"
              onKeyDown={e => e.key === "Enter" && handleCreateRoom()} />
            <div className="relative">
              <Input type={showRoomPw ? "text" : "password"}
                value={roomPassword} onChange={e => setRoomPassword(e.target.value)}
                placeholder="Password (optional)"
                className="h-11 bg-white/[0.04] border-white/10 rounded-xl pr-10"
                maxLength={64} />
              <button type="button" onClick={() => setShowRoomPw(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showRoomPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {privileged
                ? "Your room lasts forever. ∞"
                : "Room lasts 24h. Costs 20 credits."}
              {roomPassword.trim() && " 🔒 Password protected."}
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

      {/* ── Join locked room modal ─────────────────────────────────────────── */}
      {joinTarget && (
        <Modal onClose={() => { setJoinTarget(null); setJoinPassword(""); }}
          title={`🔒 ${joinTarget.displayName}`}>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">This room is password-protected.</p>
            <div className="relative">
              <Input type={showJoinPw ? "text" : "password"}
                value={joinPassword}
                onChange={e => { setJoinPassword(e.target.value); setJoinPwError(false); }}
                placeholder="Enter room password" autoFocus
                className={`h-11 bg-white/[0.04] rounded-xl pr-10
                  ${joinPwError ? "border-destructive/60" : "border-white/10"}`}
                onKeyDown={e => e.key === "Enter" && handleJoinWithPassword()} />
              <button type="button" onClick={() => setShowJoinPw(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showJoinPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {joinPwError && <p className="text-xs text-destructive">Incorrect password. Try again.</p>}
            <div className="flex gap-2">
              <Button onClick={() => { setJoinTarget(null); setJoinPassword(""); }} variant="outline"
                className="flex-1 h-10 border-white/10 rounded-xl text-sm">Cancel</Button>
              <Button onClick={handleJoinWithPassword} disabled={!joinPassword.trim()}
                className="flex-1 h-10 bg-primary rounded-xl text-sm text-white">
                <Key className="w-4 h-4 mr-1" /> Join
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── No credits modal ──────────────────────────────────────────────── */}
      {showNoCredits && (
        <Modal onClose={() => setShowNoCredits(false)} title="Need Credits 💳">
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>You need <strong className="text-foreground">20 credits</strong> to create a room.</p>
            <div className="glass rounded-xl p-4 space-y-2">
              <p className="font-medium text-foreground text-sm">How to get credits:</p>
              <p>1. Send via <strong className="text-foreground">Vodafone Cash</strong></p>
              <p className="font-mono text-primary text-lg font-bold">01026703525</p>
              <p>2. Tell the owner your username: <span className="text-foreground font-medium">{myName}</span></p>
            </div>
            <Button onClick={() => setShowNoCredits(false)} className="w-full h-10 bg-primary rounded-xl text-white text-sm">Got it</Button>
          </div>
        </Modal>
      )}

      {/* ── Owner admin panel ─────────────────────────────────────────────── */}
      {showAdmin && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowAdmin(false)}>
          <div className="glass-strong border-t border-white/10 rounded-t-3xl p-5 shadow-2xl animate-slide-up max-h-[85vh] flex flex-col"
            style={{ maxWidth: 500, margin: "0 auto", width: "100%" }}
            onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" />
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <h2 className="font-mono font-bold text-foreground flex items-center gap-2">
                <Crown className="w-4 h-4 text-amber-400" /> Owner Panel
              </h2>
              <button onClick={() => setShowAdmin(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex rounded-xl overflow-hidden border border-white/10 mb-4 flex-shrink-0">
              {(["add", "users", "rooms"] as const).map(tab => (
                <button key={tab} onClick={() => { setAdminTab(tab); if (tab === "users") getUsers(); }}
                  className={`flex-1 py-2 text-xs font-medium transition-colors
                    ${adminTab === tab ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                  {tab === "add" ? "Add Credits" : tab === "users" ? "Users" : "Rooms"}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {adminTab === "add" && (
                <div className="space-y-3">
                  <Input value={targetName} onChange={e => setTargetName(e.target.value)}
                    placeholder="Username" className="h-11 bg-white/[0.04] border-white/10 rounded-xl" />
                  <div className="flex gap-2">
                    <Input value={creditAmt} onChange={e => setCreditAmt(e.target.value)}
                      type="number" min="1" max="10000" placeholder="Amount"
                      className="h-11 bg-white/[0.04] border-white/10 rounded-xl w-28 flex-shrink-0" />
                    <Button onClick={handleAddCredits} disabled={!targetName.trim()}
                      className="flex-1 h-11 bg-primary rounded-xl text-white text-sm">Add Credits</Button>
                  </div>
                  <p className="text-xs text-muted-foreground/60">1 room = 20 credits.</p>
                </div>
              )}
              {adminTab === "users" && (
                <div className="space-y-1.5">
                  {userList.length === 0 ? (
                    <p className="text-muted-foreground text-sm text-center py-4">No registered users yet.</p>
                  ) : userList.map(u => (
                    <div key={u.name} className="flex items-center justify-between glass rounded-xl px-3 py-2">
                      <div className="flex items-center gap-2">
                        <UserCheck className={`w-4 h-4 ${u.online ? "text-emerald-400" : "text-muted-foreground/40"}`} />
                        <span className="text-sm font-medium">{u.name}</span>
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">{u.credits} cr</span>
                    </div>
                  ))}
                </div>
              )}
              {adminTab === "rooms" && (
                <div className="space-y-1.5">
                  {rooms.length === 0 ? (
                    <p className="text-muted-foreground text-sm text-center py-4">No active rooms.</p>
                  ) : rooms.map(r => (
                    <div key={r.id} className="flex items-center justify-between glass rounded-xl px-3 py-2 gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{r.displayName}</span>
                          {r.hasPassword  && <Lock className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
                          {r.isPermanent  && <InfinityIcon className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          by {r.createdBy} · {r.participantCount} online · {timeLeft(r.expiresAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!r.isPermanent && (
                          <button onClick={() => extendRoomTime(r.id, 24)}
                            className="p-1.5 rounded-lg text-emerald-400/50 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                            title="+24h">
                            <PlusCircle className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => ownerDeleteRoom(r.id)}
                          className="p-1.5 rounded-lg text-destructive/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Delete room">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function RoomCard({
  room, myName, isOwner, canExtend, onJoin, onExtend, onDelete,
}: {
  room: RoomInfo; myName: string; isOwner: boolean; canExtend: boolean;
  onJoin: () => void; onExtend: () => void; onDelete: () => void;
}) {
  const isPermanent = room.isPermanent;

  return (
    <div className="glass rounded-2xl overflow-hidden animate-slide-up">
      <div onClick={onJoin}
        className="p-4 flex items-center justify-between gap-3
          hover:bg-white/[0.06] transition-colors group cursor-pointer">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-foreground truncate">{room.displayName}</p>
            {room.hasPassword && (
              <span title="Password protected">
                <Lock className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
              </span>
            )}
            {isPermanent && (
              <span title="Permanent room"><InfinityIcon className="w-3.5 h-3.5 text-amber-300/70 flex-shrink-0" /></span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="w-3 h-3" /> {room.participantCount}
            </span>
            <span className={`text-xs flex items-center gap-1 ${isPermanent ? "text-amber-400/70" : "text-muted-foreground"}`}>
              <Clock className="w-3 h-3" /> {timeLeft(room.expiresAt)}
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> {room.createdBy}
            </span>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
      </div>

      {/* Extend / Delete actions (shown below room info) */}
      {(canExtend || isOwner) && (
        <div className="border-t border-white/5 px-3 py-1.5 flex items-center justify-end gap-1">
          {canExtend && (
            <button onClick={e => { e.stopPropagation(); onExtend(); }}
              className="flex items-center gap-1 text-[11px] font-mono text-emerald-400/60 hover:text-emerald-400
                px-2 py-1 rounded-lg hover:bg-emerald-500/10 transition-colors">
              <PlusCircle className="w-3 h-3" /> +24h
            </button>
          )}
          {isOwner && (
            <button onClick={e => { e.stopPropagation(); onDelete(); }}
              className="flex items-center gap-1 text-[11px] font-mono text-destructive/40 hover:text-destructive
                px-2 py-1 rounded-lg hover:bg-destructive/10 transition-colors">
              <Trash2 className="w-3 h-3" /> delete
            </button>
          )}
        </div>
      )}
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
          <h2 className="font-mono font-bold text-lg text-foreground truncate">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-2 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
