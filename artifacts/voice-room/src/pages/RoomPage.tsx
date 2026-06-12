import { useEffect, useState, useRef, useCallback } from "react";
import { useSocket } from "@/context/SocketContext";
import { useWebRTC, NetworkQuality } from "@/hooks/useWebRTC";
import { useSpeakingDetection } from "@/hooks/useSpeakingDetection";
import { ParticipantCard } from "@/components/ParticipantCard";
import { ScaryOverlay } from "@/components/ScaryOverlay";
import {
  Mic, MicOff, LogOut, Ghost, Volume2, VolumeX, Radio, Zap,
} from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

export default function RoomPage() {
  const {
    participants, participantId, isOwner, isConnected,
    setSelfMuted, leaveRoom, flashlightOn, isForceMuted,
  } = useSocket();

  const [, setLocation]      = useLocation();
  const { toast }            = useToast();

  // Local raw microphone stream
  const [localStream, setLocalStream]         = useState<MediaStream | null>(null);
  // Processed stream sent to WebRTC (may have gain boost for owner)
  const [processedStream, setProcessedStream] = useState<MediaStream | null>(null);

  const [isMuted, setIsMuted]           = useState(false);
  const [isSpeakerOff, setIsSpeakerOff] = useState(false);
  const [isPTT, setIsPTT]               = useState(false);
  const [pttActive, setPttActive]       = useState(false);
  const [isBoosted, setIsBoosted]       = useState(false);  // owner mic boost
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Refs for owner gain processing
  const boostCtxRef  = useRef<AudioContext | null>(null);
  const boostGainRef = useRef<GainNode | null>(null);
  const flashStreamRef = useRef<MediaStream | null>(null);

  const effectiveMuted = isPTT ? !pttActive : (isMuted || isForceMuted);

  // ── WebRTC: use processed stream (gain-boosted for owner) ─────────────
  const { networkQuality } = useWebRTC(processedStream, isSpeakerOff);
  useSpeakingDetection(localStream, effectiveMuted);

  // ── Redirect if not joined ────────────────────────────────────────────
  useEffect(() => {
    if (!participantId) setLocation("/");
  }, [participantId, setLocation]);

  // ── Microphone capture ────────────────────────────────────────────────
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
          title: "Microphone denied",
          description: "Allow microphone access and refresh.",
          variant: "destructive",
        });
      }
    })();
    return () => { stream?.getTracks().forEach(t => t.stop()); };
  }, [toast]);

  // ── Owner gain processing pipeline ───────────────────────────────────
  // Guest: processedStream = localStream directly.
  // Owner: localStream → AudioContext Source → GainNode → MediaStreamDestination
  //        Boost button changes gain.value between 1.0 and 2.8.
  useEffect(() => {
    if (!localStream) return;

    if (!isOwner) {
      // Non-owner: use raw stream
      setProcessedStream(localStream);
      return;
    }

    // Owner: build gain-processing chain
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: 48000 });
    } catch {
      setProcessedStream(localStream);
      return;
    }
    boostCtxRef.current = ctx;

    const src  = ctx.createMediaStreamSource(localStream);
    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    boostGainRef.current = gain;

    const dest = ctx.createMediaStreamDestination();
    src.connect(gain);
    gain.connect(dest);

    // Resume ctx (may need user gesture — RoomPage is only shown after joining)
    ctx.resume().catch(() => {});

    setProcessedStream(dest.stream);

    return () => {
      ctx.close().catch(() => {});
      boostCtxRef.current  = null;
      boostGainRef.current = null;
    };
  }, [localStream, isOwner]);

  // ── Update boost gain value ───────────────────────────────────────────
  useEffect(() => {
    if (!boostGainRef.current) return;
    boostGainRef.current.gain.setTargetAtTime(
      isBoosted ? 2.8 : 1.0,
      boostCtxRef.current?.currentTime ?? 0,
      0.05,  // 50 ms smooth ramp
    );
  }, [isBoosted]);

  // ── Mute local tracks ─────────────────────────────────────────────────
  useEffect(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(t => { t.enabled = !effectiveMuted; });
    setSelfMuted(effectiveMuted);
  }, [effectiveMuted, localStream, setSelfMuted]);

  // ── PTT handlers ──────────────────────────────────────────────────────
  const startPTT = useCallback(() => { if (isPTT) setPttActive(true);  }, [isPTT]);
  const stopPTT  = useCallback(() => { if (isPTT) setPttActive(false); }, [isPTT]);

  // ── Flashlight ────────────────────────────────────────────────────────
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

  // ── Overall network quality ───────────────────────────────────────────
  const overallQuality = (): NetworkQuality => {
    const order: NetworkQuality[] = ["poor", "fair", "good", "excellent", "unknown"];
    let worst: NetworkQuality = "unknown";
    for (const q of networkQuality.values()) {
      if (order.indexOf(q) < order.indexOf(worst)) worst = q;
    }
    return worst;
  };
  const oqColor: Record<NetworkQuality, string> = {
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

      {/* Ambient glow */}
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
          {networkQuality.size > 0 && (
            <span className={`text-xs font-mono hidden sm:inline capitalize ${oqColor[overallQuality()]}`}>
              {overallQuality()}
            </span>
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
              <p className="text-muted-foreground/50 font-mono text-sm">Waiting for souls…</p>
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

      {/* ── Control bar ───────────────────────────────────────────────── */}
      <footer className="relative z-10 px-4 py-5 border-t border-white/6 bg-background/60 backdrop-blur-xl">
        <div className="max-w-sm mx-auto">
          <div className="flex items-center justify-center gap-3">

            {/* Speaker toggle */}
            <button
              onClick={() => setIsSpeakerOff(p => !p)}
              className={`w-13 h-13 rounded-2xl flex items-center justify-center transition-all active:scale-95
                ${isSpeakerOff
                  ? "bg-destructive/20 text-destructive ring-1 ring-destructive/30"
                  : "glass text-muted-foreground hover:text-foreground"}`}
              style={{ width: 52, height: 52 }}
              title="Toggle speaker"
            >
              {isSpeakerOff ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>

            {/* Owner mic boost — only visible to owner */}
            {isOwner && (
              <button
                onClick={() => setIsBoosted(p => !p)}
                className={`w-13 h-13 rounded-2xl flex flex-col items-center justify-center gap-0.5
                  transition-all active:scale-95 border
                  ${isBoosted
                    ? "bg-amber-500/20 text-amber-300 border-amber-400/40 shadow-[0_0_14px_rgba(251,191,36,0.35)]"
                    : "glass text-muted-foreground border-transparent hover:text-amber-300"}`}
                style={{ width: 52, height: 52 }}
                title="Mic boost (Owner only)"
              >
                <Zap className="w-4 h-4" />
                <span className="text-[9px] font-mono uppercase tracking-widest leading-none">
                  {isBoosted ? "2.8×" : "boost"}
                </span>
              </button>
            )}

            {/* PTT mode toggle */}
            <button
              onClick={() => setIsPTT(p => !p)}
              className={`rounded-xl flex items-center justify-center transition-all active:scale-95
                ${isPTT
                  ? "bg-primary/20 text-primary ring-1 ring-primary/30"
                  : "glass text-muted-foreground/50 hover:text-muted-foreground"}`}
              style={{ width: 40, height: 40 }}
              title="Push-to-talk mode"
            >
              <Radio className="w-4 h-4" />
            </button>

            {/* Main mic button */}
            {isPTT ? (
              <button
                onPointerDown={startPTT}
                onPointerUp={stopPTT}
                onPointerLeave={stopPTT}
                className={`rounded-3xl flex flex-col items-center justify-center gap-1
                  transition-all duration-100 select-none touch-none
                  ${pttActive
                    ? "bg-cyan-500 shadow-[0_0_30px_rgba(34,211,238,0.6)] scale-105 text-white"
                    : "glass-strong text-muted-foreground"}`}
                style={{ width: 76, height: 76 }}
              >
                <Mic className="w-7 h-7" />
                <span className="text-[9px] font-mono uppercase tracking-widest">
                  {pttActive ? "Live" : "Hold"}
                </span>
              </button>
            ) : (
              <button
                onClick={() => { if (!isForceMuted) setIsMuted(p => !p); }}
                disabled={isForceMuted}
                className={`rounded-3xl flex items-center justify-center
                  transition-all duration-200 active:scale-95
                  ${isForceMuted ? "opacity-50 cursor-not-allowed" : ""}
                  ${effectiveMuted
                    ? "bg-destructive/90 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)]"
                    : "bg-primary text-white shadow-[0_0_20px_rgba(139,92,246,0.4)] hover:bg-primary/90"}`}
                style={{ width: 76, height: 76 }}
              >
                {effectiveMuted ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
              </button>
            )}

            {/* Leave */}
            <button
              onClick={() => setConfirmLeave(true)}
              className="glass flex items-center justify-center text-muted-foreground
                hover:text-destructive hover:ring-1 hover:ring-destructive/30
                rounded-2xl transition-all active:scale-95"
              style={{ width: 52, height: 52 }}
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>

          {/* Status text */}
          <div className="text-center mt-3 h-4">
            {isForceMuted && (
              <p className="text-xs text-destructive/70 font-mono animate-pulse">muted by owner</p>
            )}
            {isOwner && isBoosted && !isForceMuted && (
              <p className="text-xs text-amber-400/60 font-mono">mic boost active — 2.8×</p>
            )}
            {isPTT && !isForceMuted && !isBoosted && (
              <p className="text-xs text-muted-foreground/50 font-mono">hold mic button to speak</p>
            )}
          </div>
        </div>
      </footer>

      {/* ── Leave dialog ─────────────────────────────────────────────── */}
      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-strong rounded-2xl p-6 max-w-[300px] w-full text-center space-y-5 shadow-2xl animate-slide-up">
            <Ghost className="w-10 h-10 text-primary mx-auto animate-float-ghost" />
            <div>
              <h2 className="font-mono font-bold text-lg text-foreground">Leave the void?</h2>
              <p className="text-sm text-muted-foreground mt-1">Your soul will leave GhostRoom.</p>
            </div>
            <div className="flex gap-3">
              <button
                className="flex-1 h-11 rounded-xl border border-white/10 text-sm hover:bg-white/5 transition-all"
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
