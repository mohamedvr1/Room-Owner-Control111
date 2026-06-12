import { useEffect, useState, useRef, useCallback } from "react";
import { useSocket } from "@/context/SocketContext";
import { useWebRTC, NetworkQuality } from "@/hooks/useWebRTC";
import { useSpeakingDetection } from "@/hooks/useSpeakingDetection";
import { ParticipantCard } from "@/components/ParticipantCard";
import { ScaryOverlay } from "@/components/ScaryOverlay";
import {
  Mic, MicOff, LogOut, Ghost, Volume2, VolumeX,
  Wifi, WifiOff, Radio,
} from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

export default function RoomPage() {
  const {
    participants, participantId, isConnected,
    setSelfMuted, leaveRoom, flashlightOn, isForceMuted,
  } = useSocket();

  const [, setLocation]       = useLocation();
  const { toast }             = useToast();
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [audioCtx, setAudioCtx]       = useState<AudioContext | null>(null);
  const [isMuted, setIsMuted]         = useState(false);
  const [isSpeakerOff, setIsSpeakerOff] = useState(false);
  const [isPTT, setIsPTT]             = useState(false);
  const [pttActive, setPttActive]     = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const flashStreamRef = useRef<MediaStream | null>(null);

  const effectiveMuted = isPTT ? !pttActive : (isMuted || isForceMuted);

  // WebRTC mesh — P2P audio with Opus codec
  const { networkQuality } = useWebRTC(localStream, audioCtx, isSpeakerOff);
  useSpeakingDetection(localStream, effectiveMuted);

  // Redirect if not joined
  useEffect(() => {
    if (!participantId) setLocation("/");
  }, [participantId, setLocation]);

  // Shared AudioContext at 48 kHz (Opus native rate)
  useEffect(() => {
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    setAudioCtx(ctx);
    const resume = () => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); };
    document.addEventListener("click",    resume, { once: true });
    document.addEventListener("touchend", resume, { once: true });
    ctx.resume().catch(() => {});
    return () => { ctx.close().catch(() => {}); };
  }, []);

  // Microphone with full browser-native audio processing
  useEffect(() => {
    let stream: MediaStream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl:  true,
            sampleRate:       48000,
            channelCount:     1,
          },
          video: false,
        });
        setLocalStream(stream);
      } catch {
        toast({
          title: "Microphone access denied",
          description: "Allow microphone access in browser settings.",
          variant: "destructive",
        });
      }
    })();
    return () => { stream?.getTracks().forEach(t => t.stop()); };
  }, [toast]);

  // Sync mute state
  useEffect(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(t => { t.enabled = !effectiveMuted; });
    setSelfMuted(effectiveMuted);
  }, [effectiveMuted, localStream, setSelfMuted]);

  // PTT handlers
  const startPTT = useCallback(() => { if (isPTT) setPttActive(true); }, [isPTT]);
  const stopPTT  = useCallback(() => { if (isPTT) setPttActive(false); }, [isPTT]);

  // Flashlight
  useEffect(() => {
    if (flashlightOn) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then(s => {
          flashStreamRef.current = s;
          const t = s.getVideoTracks()[0];
          // @ts-ignore
          t.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {});
        }).catch(() => {});
    } else {
      flashStreamRef.current?.getTracks().forEach(t => t.stop());
      flashStreamRef.current = null;
    }
    return () => { flashStreamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [flashlightOn]);

  // Overall network quality from all peers
  const worstQuality = (): NetworkQuality => {
    const order: NetworkQuality[] = ["poor", "fair", "good", "excellent", "unknown"];
    let worst: NetworkQuality = "unknown";
    for (const q of networkQuality.values()) {
      if (order.indexOf(q) < order.indexOf(worst)) worst = q;
    }
    return worst;
  };
  const overallQuality = worstQuality();

  const qualityColor: Record<NetworkQuality, string> = {
    excellent: "text-emerald-400",
    good:      "text-lime-400",
    fair:      "text-amber-400",
    poor:      "text-red-400",
    unknown:   "text-muted-foreground",
  };

  if (!participantId) return null;

  const speakerCount = participants.filter(p => p.isSpeaking && !p.isMuted).length;

  return (
    <div className="min-h-dvh flex flex-col bg-background relative overflow-hidden">
      <ScaryOverlay />

      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px]
          bg-primary/6 blur-[80px] rounded-full" />
        {speakerCount > 0 && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 w-[300px] h-[150px]
            bg-cyan-500/8 blur-[60px] rounded-full transition-opacity duration-500" />
        )}
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-5 py-4
        border-b border-white/6 bg-background/60 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <Ghost className="w-5 h-5 text-primary" />
          <span className="font-mono font-bold text-lg tracking-tight text-foreground">
            GhostRoom
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Network status */}
          {networkQuality.size > 0 && (
            <div className={`flex items-center gap-1.5 text-xs font-mono ${qualityColor[overallQuality]}`}>
              {isConnected
                ? <Wifi className="w-3.5 h-3.5" />
                : <WifiOff className="w-3.5 h-3.5 text-destructive animate-pulse" />}
              <span className="hidden sm:inline capitalize">{overallQuality}</span>
            </div>
          )}

          <div className="flex items-center gap-1.5 text-sm text-muted-foreground font-mono">
            <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-destructive animate-pulse"}`} />
            <span>{participants.length} soul{participants.length !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </header>

      {/* Participants grid */}
      <main className="flex-1 relative z-10 p-4 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          {participants.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Ghost className="w-16 h-16 text-white/10 animate-float-ghost" />
              <p className="text-muted-foreground/50 font-mono text-sm">
                Waiting for souls to enter…
              </p>
            </div>
          ) : (
            <div className={`grid gap-3
              ${participants.length === 1 ? "grid-cols-1 max-w-[200px] mx-auto" : ""}
              ${participants.length === 2 ? "grid-cols-2 max-w-[420px] mx-auto" : ""}
              ${participants.length >= 3  ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4" : ""}
            `}>
              {participants.map(p => (
                <ParticipantCard
                  key={p.id}
                  participant={p}
                  isSelf={p.id === participantId}
                  quality={networkQuality.get(p.id)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Control bar */}
      <footer className="relative z-10 px-4 py-5 border-t border-white/6 bg-background/60 backdrop-blur-xl">
        <div className="max-w-sm mx-auto">
          <div className="flex items-center justify-center gap-4">

            {/* Speaker */}
            <button
              onClick={() => setIsSpeakerOff(p => !p)}
              className={`w-14 h-14 rounded-2xl flex items-center justify-center
                transition-all duration-200 active:scale-95
                ${isSpeakerOff
                  ? "bg-destructive/20 text-destructive ring-1 ring-destructive/30"
                  : "glass text-muted-foreground hover:text-foreground hover:bg-white/8"}`}
              data-testid="button-togglespeaker"
            >
              {isSpeakerOff ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
            </button>

            {/* PTT toggle */}
            <button
              onClick={() => setIsPTT(p => !p)}
              className={`w-10 h-10 rounded-xl flex items-center justify-center
                transition-all duration-200 active:scale-95 text-xs font-mono
                ${isPTT
                  ? "bg-primary/20 text-primary ring-1 ring-primary/30"
                  : "glass text-muted-foreground/50 hover:text-muted-foreground"}`}
              title="Toggle push-to-talk"
            >
              <Radio className="w-4 h-4" />
            </button>

            {/* Main mic button */}
            {isPTT ? (
              <button
                onPointerDown={startPTT}
                onPointerUp={stopPTT}
                onPointerLeave={stopPTT}
                className={`w-20 h-20 rounded-3xl flex items-center justify-center
                  transition-all duration-100 select-none touch-none
                  ${pttActive
                    ? "bg-cyan-500 shadow-[0_0_30px_rgba(34,211,238,0.6)] scale-105 text-white"
                    : "glass-strong text-muted-foreground"}`}
                data-testid="button-ptt"
              >
                <div className="flex flex-col items-center gap-1">
                  <Mic className="w-7 h-7" />
                  <span className="text-[9px] font-mono uppercase tracking-widest">
                    {pttActive ? "Live" : "Hold"}
                  </span>
                </div>
              </button>
            ) : (
              <button
                onClick={() => { if (!isForceMuted) setIsMuted(p => !p); }}
                disabled={isForceMuted}
                className={`w-20 h-20 rounded-3xl flex items-center justify-center
                  transition-all duration-200 active:scale-95
                  ${isForceMuted ? "opacity-50 cursor-not-allowed" : ""}
                  ${effectiveMuted
                    ? "bg-destructive/90 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)]"
                    : "bg-primary text-white shadow-[0_0_20px_rgba(139,92,246,0.4)] hover:bg-primary/90"
                  }`}
                data-testid="button-togglemute"
              >
                {effectiveMuted ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
              </button>
            )}

            {/* Leave */}
            <button
              onClick={() => setConfirmLeave(true)}
              className="w-14 h-14 rounded-2xl glass flex items-center justify-center
                text-muted-foreground hover:text-destructive hover:bg-destructive/10
                hover:ring-1 hover:ring-destructive/30 transition-all duration-200 active:scale-95"
              data-testid="button-leaveroom"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>

          {/* Status text */}
          <div className="text-center mt-3 h-4">
            {isForceMuted && (
              <p className="text-xs text-destructive/70 font-mono animate-pulse">
                muted by owner
              </p>
            )}
            {isPTT && !isForceMuted && (
              <p className="text-xs text-muted-foreground/50 font-mono">
                push-to-talk active — hold mic to speak
              </p>
            )}
          </div>
        </div>
      </footer>

      {/* Leave dialog */}
      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-strong rounded-2xl p-6 max-w-[300px] w-full text-center space-y-5 shadow-2xl animate-slide-up">
            <Ghost className="w-10 h-10 text-primary mx-auto animate-float-ghost" />
            <div>
              <h2 className="font-mono font-bold text-lg text-foreground">Leave the void?</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Your soul will leave GhostRoom.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                className="flex-1 h-11 rounded-xl border border-white/10 text-sm
                  hover:bg-white/5 transition-all text-foreground"
                onClick={() => setConfirmLeave(false)}
              >
                Stay
              </button>
              <button
                className="flex-1 h-11 rounded-xl bg-destructive/90 text-white text-sm font-medium
                  hover:bg-destructive transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                onClick={() => { setConfirmLeave(false); leaveRoom(); }}
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
