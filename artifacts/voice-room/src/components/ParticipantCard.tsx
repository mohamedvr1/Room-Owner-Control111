import React from "react";
import { Participant } from "@workspace/api-client-react/src/generated/api.schemas";
import { useSocket } from "@/context/SocketContext";
import { Ghost, Mic, MicOff, Zap, Power, PowerOff, UserMinus, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ParticipantCard({ participant }: { participant: Participant }) {
  const { isOwner, participantId, ownerMute, ownerScare, ownerFlashlight, ownerKick } = useSocket();
  const isSelf = participant.id === participantId;

  return (
    <div className={`relative overflow-hidden rounded-lg border p-4 transition-all duration-500
      ${participant.isSpeaking ? 'border-primary shadow-[0_0_15px_rgba(255,0,0,0.5)] animate-pulse-glow bg-card/80' : 'border-border bg-card/40 hover:bg-card/60'}
    `} data-testid={`card-participant-${participant.id}`}>
      
      <div className="flex flex-col h-full gap-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center bg-background border
              ${participant.isOwner ? 'border-accent text-accent' : 'border-muted text-muted-foreground'}
              ${participant.isSpeaking ? 'animate-heartbeat' : ''}
            `}>
              <Ghost className="w-6 h-6" />
            </div>
            {participant.isSpeaking && (
              <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-primary rounded-full animate-ping" />
            )}
            {participant.isMuted && (
              <span className="absolute -bottom-1 -right-1 w-5 h-5 bg-destructive rounded-full flex items-center justify-center text-destructive-foreground">
                <MicOff className="w-3 h-3" />
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-lg truncate text-foreground flex items-center gap-2">
              {participant.name}
              {isSelf && <span className="text-xs font-normal text-muted-foreground">(You)</span>}
              {participant.isOwner && <ShieldAlert className="w-4 h-4 text-accent" />}
            </p>
          </div>
        </div>

        {isOwner && !isSelf && (
          <div className="pt-2 mt-auto border-t border-border/50 grid grid-cols-4 gap-1">
            <Button 
              variant="outline" 
              size="icon" 
              className={`h-8 border-none hover:bg-destructive/20 hover:text-destructive ${participant.isMuted ? 'text-destructive bg-destructive/10' : 'text-muted-foreground'}`}
              onClick={() => ownerMute(participant.id, !participant.isMuted)}
              title={participant.isMuted ? "Unmute" : "Mute"}
              data-testid={`button-ownermute-${participant.id}`}
            >
              {participant.isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
            
            <Button 
              variant="outline" 
              size="icon" 
              className="h-8 border-none text-muted-foreground hover:bg-primary/20 hover:text-primary"
              onClick={() => ownerScare(participant.id)}
              title="Jump Scare"
              data-testid={`button-ownerscare-${participant.id}`}
            >
              <Zap className="w-4 h-4" />
            </Button>
            
            <Button 
              variant="outline" 
              size="icon" 
              className="h-8 border-none text-muted-foreground hover:bg-yellow-500/20 hover:text-yellow-500"
              onClick={() => ownerFlashlight(participant.id, true)}
              title="Flashlight On"
              data-testid={`button-ownerflashlight-${participant.id}`}
            >
              <Power className="w-4 h-4" />
            </Button>
            
            <Button 
              variant="outline" 
              size="icon" 
              className="h-8 border-none text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
              onClick={() => ownerKick(participant.id)}
              title="Kick"
              data-testid={`button-ownerkick-${participant.id}`}
            >
              <UserMinus className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
