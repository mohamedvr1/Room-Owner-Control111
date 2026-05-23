import { useState } from "react";
import { useSocket, SocketParticipant } from "@/context/SocketContext";
import { Ghost, Mic, MicOff, Zap, Power, PowerOff, UserMinus, ShieldAlert, Crown, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ParticipantCard({ participant }: { participant: SocketParticipant }) {
  const { isOwner, participantId, ownerMute, ownerScare, ownerFlashlight, ownerKick } = useSocket();
  const isSelf = participant.id === participantId;
  const [selected, setSelected] = useState(false);

  const isSuperOwnerCard = !!participant.isSuperOwner;
  const isOwnerCard = participant.isOwner && !isSuperOwnerCard;

  const handleClick = () => {
    if (isOwner && !isSelf) setSelected(prev => !prev);
  };

  return (
    <div
      onClick={handleClick}
      className={`relative overflow-hidden rounded-lg border p-4 transition-all duration-300
        ${isSuperOwnerCard
          ? "animate-super-owner-border bg-gradient-to-b from-pink-950/40 to-card/60"
          : isOwnerCard
            ? "border-amber-500/70 shadow-[0_0_18px_rgba(245,158,11,0.35)] bg-gradient-to-b from-amber-950/40 to-card/60"
            : participant.isSpeaking
              ? "border-primary shadow-[0_0_15px_rgba(220,38,38,0.45)] animate-pulse-glow bg-card/80"
              : "border-border bg-card/40"
        }
        ${isOwner && !isSelf ? "cursor-pointer hover:scale-[1.02]" : ""}
        ${selected ? "ring-2 ring-primary/60 scale-[1.02]" : ""}
      `}
      data-testid={`card-participant-${participant.id}`}
    >
      {/* Top strip */}
      {isSuperOwnerCard && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-pink-400 to-transparent" />
      )}
      {isOwnerCard && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
      )}

      <div className="flex flex-col h-full gap-3">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className="relative">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-300
              ${isSuperOwnerCard
                ? "border-pink-400 bg-pink-950/60 text-pink-300 shadow-[0_0_10px_rgba(236,72,153,0.5)]"
                : isOwnerCard
                  ? "border-amber-400 bg-amber-950/60 text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.4)]"
                  : participant.isSpeaking
                    ? "border-primary text-primary animate-heartbeat"
                    : "border-muted text-muted-foreground bg-background"
              }
            `}>
              <Ghost className="w-6 h-6" />
            </div>

            {participant.isSpeaking && !participant.isMuted && (
              <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-primary rounded-full animate-ping" />
            )}
            {participant.isMuted && (
              <span className="absolute -bottom-1 -right-1 w-5 h-5 bg-destructive rounded-full flex items-center justify-center">
                <MicOff className="w-3 h-3 text-destructive-foreground" />
              </span>
            )}
          </div>

          {/* Name */}
          <div className="flex-1 min-w-0">
            <p className={`font-bold text-sm truncate flex items-center gap-1.5
              ${isSuperOwnerCard ? "text-pink-300" : isOwnerCard ? "text-amber-300" : "text-foreground"}
            `}>
              {participant.name}
              {isSelf && <span className="text-xs font-normal text-muted-foreground">(You)</span>}
            </p>
            {isSuperOwnerCard && (
              <p className="text-[10px] text-pink-400/80 font-mono uppercase tracking-widest flex items-center gap-1 mt-0.5">
                <Crown className="w-3 h-3" /> Super Owner
              </p>
            )}
            {isOwnerCard && (
              <p className="text-[10px] text-amber-500/80 font-mono uppercase tracking-widest flex items-center gap-1 mt-0.5">
                <ShieldAlert className="w-3 h-3" /> Owner
              </p>
            )}
          </div>

          {/* Close selected */}
          {selected && isOwner && !isSelf && (
            <button
              onClick={e => { e.stopPropagation(); setSelected(false); }}
              className="text-muted-foreground hover:text-foreground"
              data-testid={`button-closecontrols-${participant.id}`}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Owner controls — shown when card is selected */}
        {isOwner && !isSelf && selected && (
          <div
            onClick={e => e.stopPropagation()}
            className="pt-2 border-t border-primary/20 grid grid-cols-2 gap-1.5"
          >
            <Button
              variant="outline"
              size="sm"
              className={`h-8 text-xs border-border/50 gap-1.5 transition-all
                ${participant.isMuted
                  ? "text-destructive bg-destructive/10 border-destructive/40 hover:bg-destructive/20"
                  : "text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/40"
                }`}
              onClick={() => ownerMute(participant.id, !participant.isMuted)}
              data-testid={`button-ownermute-${participant.id}`}
            >
              {participant.isMuted ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
              {participant.isMuted ? "Unmute" : "Mute"}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs border-border/50 gap-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 hover:border-primary/40"
              onClick={() => ownerScare(participant.id)}
              data-testid={`button-ownerscare-${participant.id}`}
            >
              <Zap className="w-3 h-3" /> Scare
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs border-border/50 gap-1.5 text-muted-foreground hover:text-yellow-400 hover:bg-yellow-500/10 hover:border-yellow-500/40"
              onClick={() => ownerFlashlight(participant.id, true)}
              data-testid={`button-ownerflashon-${participant.id}`}
            >
              <Power className="w-3 h-3" /> Flash ON
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs border-border/50 gap-1.5 text-muted-foreground hover:text-slate-400 hover:bg-slate-500/10 hover:border-slate-500/40"
              onClick={() => ownerFlashlight(participant.id, false)}
              data-testid={`button-ownerflashoff-${participant.id}`}
            >
              <PowerOff className="w-3 h-3" /> Flash OFF
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs col-span-2 border-destructive/30 gap-1.5 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
              onClick={() => ownerKick(participant.id)}
              data-testid={`button-ownerkick-${participant.id}`}
            >
              <UserMinus className="w-3 h-3" /> Kick Out
            </Button>
          </div>
        )}

        {isOwner && !isSelf && !selected && (
          <p className="text-[10px] text-muted-foreground/40 font-mono text-center">tap to control</p>
        )}
      </div>
    </div>
  );
}
