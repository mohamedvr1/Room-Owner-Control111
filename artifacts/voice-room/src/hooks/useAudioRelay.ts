import { useEffect, useRef } from "react";
import { useSocket } from "../context/SocketContext";

const SAMPLE_RATE = 16000;
const BUFFER_SIZE = 1024; // 64 ms chunks — very low latency
const PLAY_BUFFER = 0.12; // 120 ms jitter buffer

export function useAudioRelay(
  localStream: MediaStream | null,
  isMuted: boolean,
  isSpeakerOff: boolean,
) {
  const { socket } = useSocket();

  // Use refs so callbacks always see fresh values
  const isMutedRef = useRef(isMuted);
  const socketRef = useRef(socket);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { socketRef.current = socket; }, [socket]);

  // ── Playback AudioContext ─────────────────────────────────────────────────
  const playCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const compRef = useRef<DynamicsCompressorNode | null>(null);
  const nextTimeRef = useRef<number>(0);

  useEffect(() => {
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });

    // Compressor → gain → out  (makes voice very clear and loud)
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 8;
    comp.ratio.value = 10;
    comp.attack.value = 0.001;
    comp.release.value = 0.1;

    const gain = ctx.createGain();
    gain.gain.value = 2.0;

    comp.connect(gain);
    gain.connect(ctx.destination);

    playCtxRef.current = ctx;
    gainRef.current = gain;
    compRef.current = comp;

    // Resume AudioContext after first user interaction
    const unlock = () => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); };
    document.addEventListener("click", unlock);
    document.addEventListener("touchend", unlock);
    ctx.resume().catch(() => {});

    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchend", unlock);
      ctx.close().catch(() => {});
    };
  }, []);

  // Speaker toggle
  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = isSpeakerOff ? 0 : 2.0;
  }, [isSpeakerOff]);

  // ── Sender: ScriptProcessorNode → raw PCM ────────────────────────────────
  // No MediaRecorder gaps — continuous PCM stream with zero cutting
  useEffect(() => {
    if (!localStream) return;

    const captureCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = captureCtx.createMediaStreamSource(localStream);

    // @ts-ignore — deprecated but widely supported and reliable
    const processor = captureCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);

    source.connect(processor);
    // Must connect to destination to keep the node alive
    processor.connect(captureCtx.destination);

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (isMutedRef.current) return;
      const s = socketRef.current;
      if (!s?.connected) return;

      // Copy channel data and send raw PCM Float32Array
      const raw = e.inputBuffer.getChannelData(0);
      const pcm = new Float32Array(raw); // copy — don't hold reference
      s.emit("audio-pcm", pcm.buffer);
    };

    return () => {
      processor.disconnect();
      source.disconnect();
      captureCtx.close().catch(() => {});
    };
  }, [localStream]);

  // ── Receiver: schedule PCM buffers for seamless playback ─────────────────
  useEffect(() => {
    if (!socket) return;

    const onPcm = ({ data }: { fromId: string; data: ArrayBuffer }) => {
      const ctx = playCtxRef.current;
      if (!ctx || !data) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});

      const float32 = new Float32Array(data);
      if (float32.length === 0) return;

      const buf = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
      buf.getChannelData(0).set(float32);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(compRef.current ?? gainRef.current ?? ctx.destination);

      const now = ctx.currentTime;

      // Reset if nextTime drifted too far ahead (e.g. tab was backgrounded)
      if (nextTimeRef.current > now + 1.5) nextTimeRef.current = now + PLAY_BUFFER;

      const start = Math.max(nextTimeRef.current, now + PLAY_BUFFER);
      src.start(start);
      nextTimeRef.current = start + buf.duration;
    };

    socket.on("audio-pcm", onPcm);
    return () => { socket.off("audio-pcm", onPcm); };
  }, [socket]);
}
