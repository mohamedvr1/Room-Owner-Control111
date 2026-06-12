import { useEffect } from "react";
import { useSocket } from "@/context/SocketContext";

function playScarySound() {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;

    // Low boom
    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = "sawtooth";
    boom.frequency.setValueAtTime(80, t);
    boom.frequency.exponentialRampToValueAtTime(25, t + 1.5);
    boomGain.gain.setValueAtTime(0.6, t);
    boomGain.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    boom.connect(boomGain);
    boomGain.connect(ctx.destination);
    boom.start(t);
    boom.stop(t + 1.5);

    // Distorted shriek
    const shriek = ctx.createOscillator();
    const dist   = ctx.createWaveShaper();
    const shriekGain = ctx.createGain();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      curve[i] = (Math.PI + 400) * x / (Math.PI + 400 * Math.abs(x));
    }
    dist.curve = curve;
    shriek.type = "sawtooth";
    shriek.frequency.setValueAtTime(900, t + 0.05);
    shriek.frequency.exponentialRampToValueAtTime(2200, t + 0.3);
    shriek.frequency.exponentialRampToValueAtTime(60, t + 1.2);
    shriekGain.gain.setValueAtTime(0.5, t + 0.05);
    shriekGain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    shriek.connect(dist);
    dist.connect(shriekGain);
    shriekGain.connect(ctx.destination);
    shriek.start(t + 0.05);
    shriek.stop(t + 1.2);
  } catch { /* ignore if audio blocked */ }
}

export function ScaryOverlay() {
  const { scareTriggered, clearScare } = useSocket();

  useEffect(() => {
    if (!scareTriggered) return;

    playScarySound();
    if (navigator.vibrate) navigator.vibrate([300, 100, 600, 100, 300]);

    const timer = setTimeout(clearScare, 3500);
    return () => clearTimeout(timer);
  }, [scareTriggered, clearScare]);

  if (!scareTriggered) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center
        bg-black/95 cursor-pointer animate-[fade-in_0.08s_ease-out]"
      onClick={clearScare}
      data-testid="scary-overlay"
    >
      {/* Red vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,rgba(180,0,0,0.8)_100%)]" />

      {/* Ghost emoji as scare face */}
      <div className="relative text-center select-none pointer-events-none">
        <div
          className="text-[160px] leading-none"
          style={{
            filter: "drop-shadow(0 0 60px rgba(255, 30, 30, 1)) drop-shadow(0 0 20px rgba(255,255,255,0.5))",
            animation: "scale-in 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          👻
        </div>
        <p className="text-red-400 font-mono text-xl mt-4 tracking-[0.3em] uppercase opacity-80">
          BOO!
        </p>
      </div>

      <style>{`
        @keyframes scale-in {
          from { transform: scale(4) rotate(-10deg); opacity: 0; }
          to   { transform: scale(1) rotate(0deg);   opacity: 1; }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
