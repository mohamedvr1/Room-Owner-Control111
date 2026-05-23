import { useEffect, useRef } from "react";
import { useSocket } from "../context/SocketContext";

const CHUNK_MS = 100; // ultra-low latency chunks

function bestMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export function useAudioRelay(
  localStream: MediaStream | null,
  isMuted: boolean,
  isSpeakerOff: boolean,
) {
  const { socket, participantId } = useSocket();

  // ── AudioContext + processing chain ───────────────────────────────────────
  // chain: incoming → gainNode → compressor → destination
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const nextTimeRef = useRef<number>(0);

  useEffect(() => {
    const ctx = new AudioContext({ sampleRate: 16000 });

    // Compressor — makes audio sound punchy & clear like a phone call
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 10;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.15;

    // Gain — boost the volume to make it powerful
    const gain = ctx.createGain();
    gain.gain.value = 2.2; // loud & clear

    gain.connect(compressor);
    compressor.connect(ctx.destination);

    audioCtxRef.current = ctx;
    gainRef.current = gain;
    compressorRef.current = compressor;

    const unlock = () => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); };
    document.addEventListener("click", unlock);
    document.addEventListener("touchend", unlock);
    ctx.resume().catch(() => {}); // try immediately after user joined

    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchend", unlock);
      ctx.close().catch(() => {});
    };
  }, []);

  // Speaker on/off via gain
  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = isSpeakerOff ? 0 : 2.2;
  }, [isSpeakerOff]);

  // ── Sender: capture & relay ───────────────────────────────────────────────
  useEffect(() => {
    if (!socket || !localStream) return;

    let active = true;
    const mimeType = bestMimeType();

    function cycle() {
      if (!active || !localStream) return;

      const rec = new MediaRecorder(localStream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];

      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      rec.onstop = () => {
        if (!active) return;
        if (!isMuted && chunks.length > 0) {
          const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
          blob.arrayBuffer().then((buf) => {
            if (active && socket?.connected) socket.emit("audio-chunk", buf);
          });
        }
        cycle();
      };

      rec.onerror = () => { if (active) cycle(); };

      try {
        rec.start();
        setTimeout(() => { if (rec.state === "recording") rec.stop(); }, CHUNK_MS);
      } catch {
        setTimeout(cycle, CHUNK_MS);
      }
    }

    cycle();
    return () => { active = false; };
  }, [socket, localStream, isMuted]);

  // ── Receiver: decode & schedule playback ──────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onChunk = async ({ fromId, data }: { fromId: string; data: ArrayBuffer }) => {
      if (fromId === participantId) return;
      const ctx = audioCtxRef.current;
      if (!ctx) return;

      if (ctx.state === "suspended") await ctx.resume().catch(() => {});

      try {
        const decoded = await ctx.decodeAudioData(data.slice(0));
        const src = ctx.createBufferSource();
        src.buffer = decoded;
        src.connect(gainRef.current ?? ctx.destination);

        const now = ctx.currentTime;
        // Tiny 10ms safety gap to prevent gaps
        const start = Math.max(nextTimeRef.current, now + 0.01);
        src.start(start);
        nextTimeRef.current = start + decoded.duration;
      } catch {
        // skip failed chunk
      }
    };

    socket.on("audio-chunk", onChunk);
    return () => { socket.off("audio-chunk", onChunk); };
  }, [socket, participantId]);
}
