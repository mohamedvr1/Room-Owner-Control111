import { useEffect, useState, useRef, useCallback } from "react";
import { useSocket } from "@/context/SocketContext";
import { useWebRTC, NetworkQuality } from "@/hooks/useWebRTC";
import { useSpeakingDetection } from "@/hooks/useSpeakingDetection";
import { ParticipantCard } from "@/components/ParticipantCard";
import { ScaryOverlay } from "@/components/ScaryOverlay";
import {
  Mic, MicOff, LogOut, Ghost, Volume2, VolumeX, Radio,
  Zap, AudioLines, Monitor, MonitorOff, X,
} from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

export default function RoomPage() {
  const {
    participants, participantId, isOwner, isConnected,
    setSelfMuted, leaveVoiceRoom, flashlightOn, isForceMuted,
    currentRoomId, currentRoomCreator,
    remoteScreenFromId, signalScreenShare,
  } = useSocket();

  const [, setLocation] = useLocation();
  const { toast }       = useToast();

  const [localStream, setLocalStream]         = useState<MediaStream | null>(null);
  const [processedStream, setProcessedStream] = useState<MediaStream | null>(null);

  const [isMuted, setIsMuted]             = useState(false);
  const [isSpeakerOff, setIsSpeakerOff]   = useState(false);
  const [isPTT, setIsPTT]                 = useState(false);
  const [pttActive, setPttActive]         = useState(false);
  const [isBoosted, setIsBoosted]         = useState(false);
  const [isDeepVoice, setIsDeepVoice]     = useState(false);
  const [confirmLeave, setConfirmLeave]   = useState(false);

  // Screen sharing
  const [screenStream, setScreenStream]         = useState<MediaStream | null>(null);
  const [remoteVideoStream, setRemoteVideoStream] = useState<MediaStream | null>(null);
  const screenVideoRef                          = useRef<HTMLVideoElement | null>(null);

  const boostCtxRef   = useRef<AudioContext | null>(null);
  const boostGainRef  = useRef<GainNode | null>(null);
  const deepFilterRef = useRef<BiquadFilterNode | null>(null);
  const flashStreamRef= useRef<MediaStream | null>(null);

  const effectiveMuted = isPTT ? !pttActive : (isMuted || isForceMuted);

  // Am I the room creator?
  const iAmCreator = !!(participantId && participants.find(p => p.id === participantId && p.isRoomCreator));

  // Remote video callback from useWebRTC
  const handleRemoteVideo = useCallback((stream: MediaStream | null) => {
    setRemoteVideoStream(stream);
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = stream;
      if (stream) screenVideoRef.current.play().catch(() => {});
    }
  }, []);

  const { networkQuality, addScreenTrack, removeScreenTrack } =
    useWebRTC(processedStream, isSpeakerOff, participants, participantId, handleRemoteVideo);

  useSpeakingDetection(localStream, effectiveMuted);

  useEffect(() => {
    if (!participantId || !currentRoomId) setLocation("/lobby");
  }, [participantId, currentRoomId, setLocation]);

  // Microphone
  useEffect(() => {
    let stream: MediaStream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true, noiseSuppression: true,
            autoGainControl: true, sampleRate: 48000, channelCount: 1,
          },
          video: false,
        });
        setLocalStream(stream);
      } catch {
        toast({ title: "Microphone denied", description: "Allow mic access and refresh.", variant: "destructive" });
      }
    })();
    return () => { stream?.getTracks().forEach(t => t.stop()); };
  }, [toast]);

  // Owner: AudioContext chain (bass boost + gain)
  useEffect(() => {
    if (!localStream) return;
    if (!isOwner) { setProcessedStream(localStream); return; }

    let ctx: AudioContext;
    try { ctx = new AudioContext({ sampleRate: 48000 }); }
    catch { setProcessedStream(localStream); return; }
    boostCtxRef.current = ctx;

    const src      = ctx.createMediaStreamSource(localStream);
    const highPass = ctx.createBiquadFilter();
    highPass.type  = "highpass"; highPass.frequency.value = 80; highPass.Q.value = 0.5;

    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type  = "lowshelf"; lowShelf.frequency.value = 200; lowShelf.gain.value = 0;
    deepFilterRef.current = lowShelf;

    const lowPass  = ctx.createBiquadFilter();
    lowPass.type   = "lowpass"; lowPass.frequency.value = 4000;

    const gain     = ctx.createGain();
    gain.gain.value = 1.0;
    boostGainRef.current = gain;

    const dest = ctx.createMediaStreamDestination();
    src.connect(highPass);
    highPass.connect(lowShelf);
    lowShelf.connect(lowPass);
    lowPass.connect(gain);
    gain.connect(dest);

    ctx.resume().catch(() => {});
    setProcessedStream(dest.stream);

    return () => {
      ctx.close().catch(() => {});
      boostCtxRef.current = null; boostGainRef.current = null; deepFilterRef.current = null;
    };
  }, [localStream, isOwner]);

  useEffect(() => {
    if (!boostGainRef.current) return;
    boostGainRef.current.gain.setTargetAtTime(isBoosted ? 2.8 : 1.0, boostCtxRef.current?.currentTime ?? 0, 0.05);
  }, [isBoosted]);

  useEffect(() => {
    if (!deepFilterRef.current) return;
    deepFilterRef.current.gain.setTargetAtTime(isDeepVoice ? 14 : 0, boostCtxRef.current?.currentTime ?? 0, 0.05);
  }, [isDeepVoice]);

  // Mute local tracks
  useEffect(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(t => { t.enabled = !effectiveMuted; });
    setSelfMuted(effectiveMuted);
  }, [effectiveMuted, localStream, setSelfMuted]);

  // PTT
  const startPTT = useCallback(() => { if (isPTT) setPttActive(true);  }, [isPTT]);
  const stopPTT  = useCallback(() => { if (isPTT) setPttActive(false); }, [isPTT]);

  // Flashlight
  useEffect(() => {
    if (flashlightOn) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(s => {
        flashStreamRef.current = s;
        // @ts-ignore
        s.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {});
      }).catch(() => {});
    } else {
      flashStreamRef.current?.getTracks().forEach(t => t.stop());
      flashStreamRef.current = null;
    }
    return () => { flashStreamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [flashlightOn]);

  // Screen share
  const handleScreenShare = useCallback(async () => {
    if (screenStream) {
      // Stop sharing
      const track = screenStream.getVideoTracks()[0];
      if (track) removeScreenTrack(track);
      screenStream.getTracks().forEach(t => t.stop());
      setScreenStream(null);
      signalScreenShare(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      track.onended = () => {
        removeScreenTrack(track);
        setScreenStream(null);
        signalScreenShare(false);
      };
      setScreenStream(stream);
      addScreenTrack(track, stream);
      signalScreenShare(true);
    } catch { /* user cancelled */ }
  }, [screenStream, addScreenTrack, removeScreenTrack, signalScreenShare]);

  // Clean up screen share on unmount
  useEffect(() => {
    return () => {
      if (screenStream) {
        const track = screenStream.getVideoTracks()[0];
        if (track) removeScreenTrack(track);
        screenStream.getTracks().forEach(t => t.stop());
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update remote video element when remoteVideoStream changes
  useEffect(() => {
    if (screenVideoRef.current && remoteVideoStream) {
      screenVideoRef.current.srcObject = remoteVideoStream;
      screenVideoRef.current.play().catch(() => {});
    }
  }, [remoteVideoStream]);

  // Clear remote video if no one is sharing
  useEffect(() => {
    if (!remoteScreenFromId) setRemoteVideoStream(null);
  }, [remoteScreenFromId]);

  const overallQuality = (): NetworkQuality => {
    const order: NetworkQuality[] = ["poor", "fair", "good", "excellent", "unknown"];
    let worst: NetworkQuality = "unknown";
    for (const q of networkQuality.values())
      if (order.indexOf(q) < order.indexOf(worst)) worst = q;
    return worst;
  };
  const oqColor: Record<NetworkQuality, string> = {
    excellent: "text-emerald-400", good: "text-lime-400",
    fair: "text-amber-400", poor: "text-red-400", unknown: "text-muted-foreground",
  };

  const sharerName = remoteScreenFromId
    ? participants.find(p => p.id === remoteScreenFromId)?.name ?? "Someone"
    : null;

  if (!participantId || !currentRoomId) return null;

  const speakerCount = participants.filter(p => p.isSpeaking && !p.isMuted).length;
  void speakerCount;

  return (
    <div className="min-h-dvh flex flex-col bg-background relative overflow-hidden">
      <ScaryOverlay />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/5 blur-[80px] rounded-full" />
      </div>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-5 py-4
        border-b border-white/6 bg-background/60 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <Ghost className="w-5 h-5 text-primary" />
          <span className="font-mono font-bold text-lg tracking-tight">{currentRoomCreator ? `${currentRoomCreator}'s Room` : "GhostRoom"}</span>
        </div>
        <div className="flex items-center gap-3">
          {networkQuality.size > 0 && (
            <span className={`text-xs font-mono hidden sm:inline capitalize ${oqColor[overallQuality()]}`}>{overallQuality()}</span>
          )}
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground font-mono">
            <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-destructive animate-pulse"}`} />
            <span>{participants.length} soul{participants.length !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </header>

      {/* ── Remote screen share overlay ────────────────────────────────────── */}
      {(remoteVideoStream || remoteScreenFromId) && (
        <div className="relative z-10 mx-4 mt-3 rounded-2xl overflow-hidden bg-black shadow-2xl ring-1 ring-primary/20">
          <div className="absolute top-2 left-3 z-10 text-white/60 text-xs font-mono flex items-center gap-1">
            <Monitor className="w-3 h-3" /> {sharerName} is sharing
          </div>
          <button onClick={() => { setRemoteVideoStream(null); }}
            className="absolute top-2 right-2 z-10 w-7 h-7 rounded-lg bg-black/60 flex items-center justify-center
              text-white/60 hover:text-white hover:bg-black/80 transition-colors">
            <X className="w-4 h-4" />
          </button>
          <video
            ref={el => {
              screenVideoRef.current = el;
              if (el && remoteVideoStream) { el.srcObject = remoteVideoStream; el.play().catch(() => {}); }
            }}
            autoPlay playsInline
            className="w-full max-h-[45vh] object-contain bg-black"
          />
        </div>
      )}

      {/* ── Participants grid ──────────────────────────────────────────────── */}
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
                <ParticipantCard key={p.id} participant={p}
                  isSelf={p.id === participantId}
                  quality={networkQuality.get(p.id)} />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* ── Control bar ──────────────────────────────────────────────────── */}
      <footer className="relative z-10 px-4 py-5 border-t border-white/6 bg-background/60 backdrop-blur-xl">
        <div className="max-w-sm mx-auto">
          <div className="flex items-center justify-center gap-2 flex-wrap">

            {/* Speaker */}
            <button onClick={() => setIsSpeakerOff(p => !p)}
              className={`rounded-2xl flex items-center justify-center transition-all active:scale-95
                ${isSpeakerOff ? "bg-destructive/20 text-destructive ring-1 ring-destructive/30" : "glass text-muted-foreground hover:text-foreground"}`}
              style={{ width: 48, height: 48 }}>
              {isSpeakerOff ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>

            {/* Owner: Boost */}
            {isOwner && (
              <button onClick={() => setIsBoosted(p => !p)}
                className={`rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 border
                  ${isBoosted ? "bg-amber-500/20 text-amber-300 border-amber-400/40 shadow-[0_0_14px_rgba(251,191,36,0.3)]"
                             : "glass text-muted-foreground border-transparent hover:text-amber-300"}`}
                style={{ width: 48, height: 48 }}>
                <Zap className="w-4 h-4" />
                <span className="text-[8px] font-mono">{isBoosted ? "2.8×" : "boost"}</span>
              </button>
            )}

            {/* Owner: Deep Voice */}
            {isOwner && (
              <button onClick={() => setIsDeepVoice(p => !p)}
                className={`rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 border
                  ${isDeepVoice ? "bg-violet-500/20 text-violet-300 border-violet-400/40 shadow-[0_0_14px_rgba(139,92,246,0.3)]"
                                : "glass text-muted-foreground border-transparent hover:text-violet-300"}`}
                style={{ width: 48, height: 48 }}>
                <AudioLines className="w-4 h-4" />
                <span className="text-[8px] font-mono">{isDeepVoice ? "deep" : "voice"}</span>
              </button>
            )}

            {/* Room creator: Screen Share */}
            {iAmCreator && (
              <button onClick={handleScreenShare}
                className={`rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 border
                  ${screenStream ? "bg-cyan-500/20 text-cyan-300 border-cyan-400/40 shadow-[0_0_14px_rgba(34,211,238,0.3)] animate-pulse"
                                 : "glass text-muted-foreground border-transparent hover:text-cyan-300"}`}
                style={{ width: 48, height: 48 }}>
                {screenStream ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                <span className="text-[8px] font-mono">{screenStream ? "stop" : "share"}</span>
              </button>
            )}

            {/* PTT toggle */}
            <button onClick={() => setIsPTT(p => !p)}
              className={`rounded-xl flex items-center justify-center transition-all active:scale-95
                ${isPTT ? "bg-primary/20 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground/50 hover:text-muted-foreground"}`}
              style={{ width: 36, height: 36 }}>
              <Radio className="w-4 h-4" />
            </button>

            {/* Main mic button */}
            {isPTT ? (
              <button onPointerDown={startPTT} onPointerUp={stopPTT} onPointerLeave={stopPTT}
                className={`rounded-3xl flex flex-col items-center justify-center gap-1
                  transition-all duration-100 select-none touch-none
                  ${pttActive ? "bg-cyan-500 shadow-[0_0_30px_rgba(34,211,238,0.6)] scale-105 text-white" : "glass-strong text-muted-foreground"}`}
                style={{ width: 72, height: 72 }}>
                <Mic className="w-7 h-7" />
                <span className="text-[9px] font-mono">{pttActive ? "Live" : "Hold"}</span>
              </button>
            ) : (
              <button onClick={() => { if (!isForceMuted) setIsMuted(p => !p); }} disabled={isForceMuted}
                className={`rounded-3xl flex items-center justify-center transition-all duration-200 active:scale-95
                  ${isForceMuted ? "opacity-50 cursor-not-allowed" : ""}
                  ${effectiveMuted ? "bg-destructive/90 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)]"
                                  : "bg-primary text-white shadow-[0_0_20px_rgba(139,92,246,0.4)] hover:bg-primary/90"}`}
                style={{ width: 72, height: 72 }}>
                {effectiveMuted ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
              </button>
            )}

            {/* Leave */}
            <button onClick={() => setConfirmLeave(true)}
              className="glass flex items-center justify-center text-muted-foreground
                hover:text-destructive hover:ring-1 hover:ring-destructive/30 rounded-2xl transition-all active:scale-95"
              style={{ width: 48, height: 48 }}>
              <LogOut className="w-5 h-5" />
            </button>
          </div>

          {/* Status line */}
          <div className="text-center mt-3 h-4">
            {isForceMuted && <p className="text-xs text-destructive/70 font-mono animate-pulse">muted by owner</p>}
            {!isForceMuted && isOwner && (isBoosted || isDeepVoice) && (
              <p className="text-xs text-amber-400/60 font-mono">
                {[isBoosted && "2.8× boost", isDeepVoice && "deep voice"].filter(Boolean).join(" · ")}
              </p>
            )}
            {!isForceMuted && !isBoosted && !isDeepVoice && screenStream && (
              <p className="text-xs text-cyan-400/60 font-mono animate-pulse">● sharing screen</p>
            )}
            {isPTT && !isBoosted && !isDeepVoice && !screenStream && !isForceMuted && (
              <p className="text-xs text-muted-foreground/50 font-mono">hold mic to speak</p>
            )}
          </div>
        </div>
      </footer>

      {/* ── Leave dialog ──────────────────────────────────────────────────── */}
      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-strong rounded-2xl p-6 max-w-[300px] w-full text-center space-y-5 shadow-2xl animate-slide-up">
            <Ghost className="w-10 h-10 text-primary mx-auto animate-float-ghost" />
            <div>
              <h2 className="font-mono font-bold text-lg">Leave the room?</h2>
              <p className="text-sm text-muted-foreground mt-1">You'll return to the lobby.</p>
            </div>
            <div className="flex gap-3">
              <button className="flex-1 h-11 rounded-xl border border-white/10 text-sm hover:bg-white/5 transition-all"
                onClick={() => setConfirmLeave(false)}>Stay</button>
              <button className="flex-1 h-11 rounded-xl bg-destructive/90 text-white text-sm font-medium hover:bg-destructive transition-all"
                onClick={() => { setConfirmLeave(false); leaveVoiceRoom(); }}>Leave</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
