import { useEffect, useState, useRef } from "react";
import { useSocket } from "@/context/SocketContext";
import { useAudioRelay } from "@/hooks/useAudioRelay";
import { useSpeakingDetection } from "@/hooks/useSpeakingDetection";
import { ParticipantCard } from "@/components/ParticipantCard";
import { ScaryOverlay } from "@/components/ScaryOverlay";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, LogOut, Ghost, Volume2, VolumeX } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

export default function RoomPage() {
  const {
    participants,
    participantId,
    isConnected,
    isOwner,
    setSelfMuted,
    leaveRoom,
    flashlightOn,
    isForceMuted,
  } = useSocket();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOff, setIsSpeakerOff] = useState(false);
  const flashlightStreamRef = useRef<MediaStream | null>(null);

  const effectiveMuted = isMuted || isForceMuted;
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Audio relay via server (guaranteed to work on any network)
  useAudioRelay(localStream, effectiveMuted, isSpeakerOff);
  useSpeakingDetection(localStream, effectiveMuted);

  // Only redirect if we never joined (no participantId) — not on temporary disconnect
  useEffect(() => {
    if (!participantId) setLocation("/");
  }, [participantId, setLocation]);

  // Request mic
  useEffect(() => {
    let stream: MediaStream;
    async function getMic() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 16000,
          },
          video: false,
        });
        setLocalStream(stream);
      } catch {
        toast({
          title: "تعذر الوصول للميكروفون",
          description: "اسمح بالوصول للميكروفون من إعدادات المتصفح.",
          variant: "destructive",
        });
      }
    }
    getMic();
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, [toast]);

  // Sync mute state with stream tracks + server
  useEffect(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => { t.enabled = !effectiveMuted; });
    setSelfMuted(effectiveMuted);
  }, [effectiveMuted, localStream, setSelfMuted]);

  // Flashlight
  useEffect(() => {
    if (flashlightOn) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "environment" } })
        .then((s) => {
          flashlightStreamRef.current = s;
          const track = s.getVideoTracks()[0];
          // @ts-ignore
          track.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {});
        })
        .catch(() => {});
    } else {
      flashlightStreamRef.current?.getTracks().forEach((t) => t.stop());
      flashlightStreamRef.current = null;
    }
    return () => { flashlightStreamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, [flashlightOn]);

  if (!participantId) return null;

  return (
    <div className="min-h-dvh flex flex-col bg-background relative overflow-hidden">
      <ScaryOverlay />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-primary/5 via-background to-background pointer-events-none" />

      <header className="relative z-10 flex items-center justify-between p-4 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="flex items-center gap-2 text-primary">
          <Ghost className="w-6 h-6" />
          <h1 className="font-mono font-bold text-xl tracking-wider">GhostRoom</h1>
        </div>
        <div className="text-sm text-muted-foreground font-mono">
          {participants.length} Soul{participants.length !== 1 ? "s" : ""} Online
        </div>
      </header>

      <main className="flex-1 relative z-10 p-4 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {participants.map((p) => (
              <ParticipantCard key={p.id} participant={p} />
            ))}
          </div>
        </div>
      </main>

      <footer className="relative z-10 p-4 border-t border-border/50 bg-background/80 backdrop-blur-md">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-4">

          {/* Speaker */}
          <Button
            variant="outline"
            size="lg"
            className={`rounded-full w-16 h-16 transition-all hover:scale-105 border-border/50
              ${isSpeakerOff ? "bg-destructive/10 border-destructive/50 text-destructive" : "text-foreground hover:bg-muted"}`}
            onClick={() => setIsSpeakerOff((p) => !p)}
            data-testid="button-togglespeaker"
          >
            {isSpeakerOff ? <VolumeX className="w-7 h-7" /> : <Volume2 className="w-7 h-7" />}
          </Button>

          {/* Mic */}
          <Button
            variant={effectiveMuted ? "destructive" : "default"}
            size="lg"
            className={`rounded-full w-16 h-16 shadow-lg transition-all hover:scale-105
              ${isForceMuted ? "opacity-60 cursor-not-allowed" : ""}`}
            onClick={() => { if (!isForceMuted) setIsMuted((p) => !p); }}
            data-testid="button-togglemute"
          >
            {effectiveMuted ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
          </Button>

          {/* Leave */}
          <Button
            variant="outline"
            size="lg"
            className="rounded-full w-16 h-16 border-border/50 hover:bg-destructive/20 hover:text-destructive hover:border-destructive/50 transition-all"
            onClick={() => setConfirmLeave(true)}
            data-testid="button-leaveroom"
          >
            <LogOut className="w-6 h-6" />
          </Button>
        </div>

        {isForceMuted && (
          <p className="text-center text-xs text-destructive/70 mt-2 font-mono">
            تم كتم صوتك من قبل الأونر
          </p>
        )}
      </footer>

      {/* Leave confirmation dialog */}
      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-lg p-6 max-w-xs w-full mx-4 text-center space-y-4 shadow-2xl">
            <Ghost className="w-10 h-10 text-primary mx-auto" />
            <h2 className="font-mono font-bold text-lg text-foreground">مغادرة الروم؟</h2>
            <p className="text-sm text-muted-foreground">هتخرج من GhostRoom. عايز تكمّل؟</p>
            <div className="flex gap-3 justify-center">
              <Button
                variant="outline"
                className="flex-1 border-border/60"
                onClick={() => setConfirmLeave(false)}
              >
                لأ، ابقى
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => { setConfirmLeave(false); leaveRoom(); }}
              >
                اخرج
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
