import { useEffect, useState, useRef, useCallback } from "react";
import { useSocket } from "@/context/SocketContext";
import { useWebRTC } from "@/hooks/useWebRTC";
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
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  // AudioContext — created once, used for all remote audio playback
  const audioCtxRef = useRef<AudioContext | null>(null);
  const flashlightStreamRef = useRef<MediaStream | null>(null);

  // Create AudioContext on mount (user already clicked "Enter Room" = user interaction)
  useEffect(() => {
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    // Resume immediately — page was reached via click so autoplay is allowed
    ctx.resume().then(() => setAudioUnlocked(true)).catch(() => {});
    return () => { ctx.close().catch(() => {}); };
  }, []);

  const { setOutputMuted } = useWebRTC(localStream, audioCtxRef.current);
  useSpeakingDetection(localStream, isMuted || isForceMuted);

  // Unlock audio on any tap/click (handles strict mobile browsers)
  const unlockAudio = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === "suspended") {
      ctx.resume().then(() => setAudioUnlocked(true)).catch(() => {});
    } else {
      setAudioUnlocked(true);
    }
  }, []);

  // Redirect if not in room
  useEffect(() => {
    if (!isConnected || !participantId) setLocation("/");
  }, [isConnected, participantId, setLocation]);

  // Request mic access
  useEffect(() => {
    let stream: MediaStream;
    async function getMic() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
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

  // Apply mic mute (own toggle OR force-mute from owner)
  useEffect(() => {
    if (!localStream) return;
    const enabled = !isMuted && !isForceMuted;
    localStream.getAudioTracks().forEach((t) => { t.enabled = enabled; });
    setSelfMuted(!enabled);
  }, [isMuted, isForceMuted, localStream, setSelfMuted]);

  // Speaker toggle
  useEffect(() => {
    setOutputMuted(isSpeakerOff);
    if (audioCtxRef.current && isSpeakerOff === false) {
      audioCtxRef.current.resume().catch(() => {});
    }
  }, [isSpeakerOff, setOutputMuted]);

  // Flashlight control
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

  const toggleMute = () => { if (!isForceMuted) setIsMuted((p) => !p); };
  const toggleSpeaker = () => setIsSpeakerOff((p) => !p);
  const effectiveMuted = isMuted || isForceMuted;

  if (!participantId) return null;

  return (
    <div
      className="min-h-dvh flex flex-col bg-background relative overflow-hidden"
      onClick={unlockAudio}
    >
      <ScaryOverlay />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-primary/5 via-background to-background pointer-events-none" />

      {/* Audio unlock banner — only shown if AudioContext is still suspended */}
      {!audioUnlocked && (
        <div className="relative z-20 bg-amber-900/80 border-b border-amber-600/50 px-4 py-2 text-center text-xs text-amber-200 font-mono">
          اضغط في أي مكان لتفعيل الصوت
        </div>
      )}

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
              ${isSpeakerOff
                ? "bg-destructive/10 border-destructive/50 text-destructive"
                : "text-foreground hover:bg-muted"
              }`}
            onClick={toggleSpeaker}
            data-testid="button-togglespeaker"
          >
            {isSpeakerOff ? <VolumeX className="w-7 h-7" /> : <Volume2 className="w-7 h-7" />}
          </Button>

          {/* Mic */}
          <Button
            variant={effectiveMuted ? "destructive" : "default"}
            size="lg"
            className={`rounded-full w-16 h-16 shadow-lg transition-all hover:scale-105
              ${isForceMuted ? "opacity-60 cursor-not-allowed" : ""}
            `}
            onClick={toggleMute}
            data-testid="button-togglemute"
          >
            {effectiveMuted ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
          </Button>

          {/* Leave */}
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

        {isForceMuted && (
          <p className="text-center text-xs text-destructive/70 mt-2 font-mono">
            تم كتم صوتك من قبل الأونر
          </p>
        )}
      </footer>
    </div>
  );
}
