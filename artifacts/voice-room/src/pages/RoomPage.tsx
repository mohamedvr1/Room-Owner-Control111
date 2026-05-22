import { useEffect, useState, useRef } from "react";
import { useSocket } from "@/context/SocketContext";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useSpeakingDetection } from "@/hooks/useSpeakingDetection";
import { ParticipantCard } from "@/components/ParticipantCard";
import { ScaryOverlay } from "@/components/ScaryOverlay";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, LogOut, Ghost } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

export default function RoomPage() {
  const { participants, participantId, isConnected, setSelfMuted, leaveRoom, flashlightOn } = useSocket();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const flashlightStreamRef = useRef<MediaStream | null>(null);

  // If disconnected or no participantId, bounce to join
  useEffect(() => {
    if (!isConnected || !participantId) {
      setLocation("/");
    }
  }, [isConnected, participantId, setLocation]);

  // Request Mic access
  useEffect(() => {
    let stream: MediaStream;
    async function getMic() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setLocalStream(stream);
      } catch (err) {
        console.error("Mic access denied", err);
        toast({
          title: "Microphone Access Denied",
          description: "You cannot speak in the room without microphone access.",
          variant: "destructive"
        });
      }
    }
    getMic();

    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [toast]);

  // Handle Mute local stream
  useEffect(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
      setSelfMuted(isMuted);
    }
  }, [isMuted, localStream, setSelfMuted]);

  // Handle flashlight
  useEffect(() => {
    if (flashlightOn) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then(stream => {
          flashlightStreamRef.current = stream;
          const track = stream.getVideoTracks()[0];
          // @ts-ignore
          track.applyConstraints({ advanced: [{ torch: true }] }).catch(console.error);
        })
        .catch(console.error);
    } else {
      if (flashlightStreamRef.current) {
        flashlightStreamRef.current.getTracks().forEach(t => t.stop());
        flashlightStreamRef.current = null;
      }
    }
    
    return () => {
      if (flashlightStreamRef.current) {
        flashlightStreamRef.current.getTracks().forEach(t => t.stop());
      }
    }
  }, [flashlightOn]);

  useWebRTC(localStream);
  useSpeakingDetection(localStream, isMuted);

  const toggleMute = () => setIsMuted(prev => !prev);

  if (!participantId) return null;

  return (
    <div className="min-h-dvh flex flex-col bg-background relative overflow-hidden">
      <ScaryOverlay />
      
      {/* Background ambient effect */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-primary/5 via-background to-background pointer-events-none" />
      
      <header className="relative z-10 flex items-center justify-between p-4 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="flex items-center gap-2 text-primary">
          <Ghost className="w-6 h-6" />
          <h1 className="font-mono font-bold text-xl tracking-wider">GhostRoom</h1>
        </div>
        <div className="text-sm text-muted-foreground font-mono">
          {participants.length} Soul{participants.length !== 1 ? 's' : ''} Online
        </div>
      </header>

      <main className="flex-1 relative z-10 p-4 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {participants.map(p => (
              <ParticipantCard key={p.id} participant={p} />
            ))}
          </div>
        </div>
      </main>

      <footer className="relative z-10 p-4 border-t border-border/50 bg-background/80 backdrop-blur-md">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-4">
          <Button
            variant={isMuted ? "destructive" : "default"}
            size="lg"
            className="rounded-full w-16 h-16 shadow-lg transition-all hover:scale-105"
            onClick={toggleMute}
            data-testid="button-togglemute"
          >
            {isMuted ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="rounded-full w-16 h-16 border-border/50 hover:bg-destructive/20 hover:text-destructive hover:border-destructive/50 transition-all"
            onClick={leaveRoom}
            data-testid="button-leaveroom"
          >
            <LogOut className="w-6 h-6" />
          </Button>
        </div>
      </footer>
    </div>
  );
}
