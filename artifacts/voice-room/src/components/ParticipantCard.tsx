import { useState } from "react";
import { Ghost, Mic, MicOff, Crown, Shield, Zap, UserMinus, Power, PowerOff, Home } from "lucide-react";
import { useSocket, SocketParticipant } from "@/context/SocketContext";
import { NetworkQuality } from "@/hooks/useWebRTC";
import { Button } from "@/components/ui/button";

interface Props {
  participant: SocketParticipant;
  isSelf:     boolean;
  quality?:   NetworkQuality;
}

const QUALITY_DOT: Record<NetworkQuality, string> = {
  excellent: "quality-dot-excellent",
  good:      "quality-dot-good",
  fair:      "quality-dot-fair",
  poor:      "quality-dot-poor",
  unknown:   "quality-dot-unknown",
};

const QUALITY_LABEL: Record<NetworkQuality, string> = {
  excellent: "Excellent", good: "Good", fair: "Fair", poor: "Poor", unknown: "",
};

export function ParticipantCard({ participant, isSelf, quality }: Props) {
  const { isOwner, ownerMute, ownerScare, ownerFlashlight, ownerKick } = useSocket();
  const [expanded, setExpanded] = useState(false);

  const canControl    = isOwner && !isSelf && !participant.isOwner;
  const isSpeaking    = participant.isSpeaking && !participant.isMuted;
  const isOwnerCard   = participant.isOwner;
  const isRMCard      = participant.isRM;
  const isCreatorCard = participant.isRoomCreator;

  // Avatar ring
  let avatarRingClass = "border-white/10";
  let avatarBg        = "bg-white/5";
  let avatarText      = "text-white/50";
  if (isSpeaking) {
    avatarRingClass = "border-transparent animate-speaking";
    avatarText      = "text-cyan-300";
    avatarBg        = "bg-cyan-950/40";
  } else if (isOwnerCard) {
    avatarRingClass = "border-amber-400/60 glow-owner";
    avatarText      = "text-amber-300";
    avatarBg        = "bg-amber-950/40";
  } else if (isRMCard) {
    avatarRingClass = "border-pink-400/60 glow-rm";
    avatarText      = "text-pink-300";
    avatarBg        = "bg-pink-950/40";
  } else if (isCreatorCard) {
    avatarRingClass = "border-emerald-400/50";
    avatarText      = "text-emerald-300";
    avatarBg        = "bg-emerald-950/30";
  }

  return (
    <div
      className={`relative rounded-2xl overflow-hidden glass transition-all duration-300
        ${isSpeaking ? "ring-1 ring-cyan-400/30 shadow-[0_0_20px_rgba(34,211,238,0.15)]" : ""}
        ${isOwnerCard   && !isSpeaking ? "ring-1 ring-amber-400/20"   : ""}
        ${isRMCard      && !isSpeaking ? "ring-1 ring-pink-400/20"    : ""}
        ${isCreatorCard && !isSpeaking && !isOwnerCard && !isRMCard ? "ring-1 ring-emerald-400/20" : ""}
        ${canControl ? "cursor-pointer hover:scale-[1.02] hover:ring-1 hover:ring-primary/30" : ""}
        animate-slide-up`}
      onClick={() => canControl && setExpanded(p => !p)}
    >
      <div className="p-4 flex flex-col items-center gap-3">
        {/* Network quality dot */}
        {quality && quality !== "unknown" && (
          <div className="absolute top-2.5 right-2.5">
            <span className={`w-2 h-2 block rounded-full ${QUALITY_DOT[quality]}`} title={QUALITY_LABEL[quality]} />
          </div>
        )}

        {/* Role badges — top-left */}
        <div className="absolute top-2 left-2 flex items-center gap-1">
          {isOwnerCard && (
            <div className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 bg-amber-500/20 text-amber-300">
              <Crown className="w-3 h-3" />
            </div>
          )}
          {isRMCard && (
            <div className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 bg-pink-500/20 text-pink-300">
              <Shield className="w-3 h-3" />
            </div>
          )}
          {isCreatorCard && !isOwnerCard && !isRMCard && (
            <div className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300" title="Room Host">
              <Home className="w-3 h-3" />
            </div>
          )}
        </div>

        {/* Avatar */}
        <div className="relative">
          <div className={`w-16 h-16 rounded-full border-2 flex items-center justify-center
            transition-all duration-300 ${avatarRingClass} ${avatarBg}`}>
            <Ghost className={`w-8 h-8 transition-all duration-300 ${avatarText}
              ${isSpeaking ? "animate-heartbeat" : ""}`} />
          </div>

          {participant.isMuted && (
            <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-destructive rounded-full
              flex items-center justify-center ring-2 ring-background">
              <MicOff className="w-3 h-3 text-white" />
            </div>
          )}
          {!participant.isMuted && isSpeaking && (
            <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-cyan-500 rounded-full
              flex items-center justify-center ring-2 ring-background">
              <Mic className="w-3 h-3 text-white" />
            </div>
          )}
        </div>

        {/* Name & label */}
        <div className="text-center min-w-0 w-full">
          <p className={`font-semibold text-sm truncate
            ${isOwnerCard ? "text-amber-200" : isRMCard ? "text-pink-200" : isCreatorCard ? "text-emerald-200" : isSpeaking ? "text-cyan-200" : "text-foreground"}`}>
            {participant.name}
            {isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
          </p>
          {isOwnerCard && (
            <p className="text-[10px] text-amber-400/70 font-mono uppercase tracking-widest mt-0.5">Owner</p>
          )}
          {isRMCard && !isOwnerCard && (
            <p className="text-[10px] text-pink-400/70 font-mono uppercase tracking-widest mt-0.5">RM</p>
          )}
          {isCreatorCard && !isOwnerCard && !isRMCard && (
            <p className="text-[10px] text-emerald-400/70 font-mono uppercase tracking-widest mt-0.5">Host</p>
          )}
        </div>

        {/* Owner controls */}
        {canControl && expanded && (
          <div className="w-full border-t border-white/8 pt-3 grid grid-cols-2 gap-1.5 animate-slide-up"
            onClick={e => e.stopPropagation()}>
            <Button size="sm" variant="outline"
              className={`h-8 text-xs gap-1.5 border-white/10
                ${participant.isMuted ? "text-destructive border-destructive/30 bg-destructive/10" : "text-muted-foreground hover:text-destructive"}`}
              onClick={() => ownerMute(participant.id, !participant.isMuted)}>
              {participant.isMuted ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
              {participant.isMuted ? "Unmute" : "Mute"}
            </Button>

            <Button size="sm" variant="outline"
              className="h-8 text-xs gap-1.5 border-white/10 text-muted-foreground hover:text-primary"
              onClick={() => ownerScare(participant.id)}>
              <Zap className="w-3 h-3" /> Scare
            </Button>

            <Button size="sm" variant="outline"
              className="h-8 text-xs gap-1.5 border-white/10 text-muted-foreground hover:text-yellow-400"
              onClick={() => ownerFlashlight(participant.id, true)}>
              <Power className="w-3 h-3" /> Flash
            </Button>

            <Button size="sm" variant="outline"
              className="h-8 text-xs gap-1.5 border-white/10 text-muted-foreground hover:text-slate-400"
              onClick={() => ownerFlashlight(participant.id, false)}>
              <PowerOff className="w-3 h-3" /> Dark
            </Button>

            <Button size="sm" variant="outline"
              className="h-8 text-xs col-span-2 gap-1.5 border-destructive/20 text-destructive/60 hover:text-destructive hover:bg-destructive/10"
              onClick={() => ownerKick(participant.id)}>
              <UserMinus className="w-3 h-3" /> Kick Out
            </Button>
          </div>
        )}

        {canControl && !expanded && (
          <p className="text-[10px] text-white/20 font-mono">tap to control</p>
        )}
      </div>
    </div>
  );
}
