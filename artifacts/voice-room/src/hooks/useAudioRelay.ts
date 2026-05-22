import { useEffect, useRef } from "react";
import { useSocket } from "../context/SocketContext";

const CHUNK_MS = 150; // record a complete file every 150 ms

// Prefer Opus inside WebM; fall back to whatever the browser supports
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

  // ── AudioContext for scheduled playback ───────────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextTimeRef = useRef<number>(0); // next scheduled play time per sender
  const gainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(ctx.destination);
    audioCtxRef.current = ctx;
    gainRef.current = gain;

    const unlock = () => {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
    };
    document.addEventListener("click", unlock);
    document.addEventListener("touchend", unlock);
    // Try to resume immediately (we're called after user clicked Join)
    ctx.resume().catch(() => {});

    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchend", unlock);
      ctx.close().catch(() => {});
    };
  }, []);

  // Mute / unmute speaker output
  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = isSpeakerOff ? 0 : 1;
  }, [isSpeakerOff]);

  // ── Sender ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket || !localStream) return;

    let active = true;
    const mimeType = bestMimeType();

    function cycle() {
      if (!active || !localStream) return;

      // Don't send if muted — still restart so we're ready when unmuted
      const rec = new MediaRecorder(
        localStream,
        mimeType ? { mimeType } : undefined,
      );
      const chunks: Blob[] = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      rec.onstop = () => {
        if (!active) return;
        if (!isMuted && chunks.length > 0) {
          const blob = new Blob(chunks, {
            type: mimeType || "audio/webm",
          });
          blob.arrayBuffer().then((buf) => {
            if (active && socket?.connected) {
              socket.emit("audio-chunk", buf);
            }
          });
        }
        cycle(); // restart immediately for next chunk
      };

      rec.onerror = () => { if (active) cycle(); };

      try {
        rec.start();
        setTimeout(() => {
          if (rec.state === "recording") rec.stop();
        }, CHUNK_MS);
      } catch {
        setTimeout(cycle, CHUNK_MS);
      }
    }

    cycle();

    return () => { active = false; };
  }, [socket, localStream, isMuted]);

  // ── Receiver ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onChunk = async ({
      fromId,
      data,
    }: {
      fromId: string;
      data: ArrayBuffer;
    }) => {
      if (fromId === participantId) return;
      const ctx = audioCtxRef.current;
      if (!ctx) return;

      // Resume context if suspended (mobile autoplay restriction)
      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => {});
      }

      try {
        const decoded = await ctx.decodeAudioData(data.slice(0));
        const src = ctx.createBufferSource();
        src.buffer = decoded;
        src.connect(gainRef.current ?? ctx.destination);

        // Schedule back-to-back with a tiny 20ms safety buffer
        const now = ctx.currentTime;
        const start = Math.max(nextTimeRef.current, now + 0.02);
        src.start(start);
        nextTimeRef.current = start + decoded.duration;
      } catch {
        // decode failed — skip this chunk
      }
    };

    socket.on("audio-chunk", onChunk);
    return () => { socket.off("audio-chunk", onChunk); };
  }, [socket, participantId]);
}
