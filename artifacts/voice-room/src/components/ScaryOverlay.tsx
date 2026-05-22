import React, { useEffect } from "react";
import scaryFace from "@/assets/scary-face.png";
import { useSocket } from "@/context/SocketContext";
import { motion, AnimatePresence } from "framer-motion";

function playScarySound() {
  try {
    const ctx = new window.AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const dist = ctx.createWaveShaper();
    
    // distortion curve
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { 
      const x = (i * 2) / 256 - 1; 
      curve[i] = (Math.PI + 400) * x / (Math.PI + 400 * Math.abs(x)); 
    }
    dist.curve = curve;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(2000, ctx.currentTime + 0.3);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 1.5);
    
    gain.gain.setValueAtTime(1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2);
    
    osc.connect(dist); 
    dist.connect(gain); 
    gain.connect(ctx.destination);
    
    osc.start(); 
    osc.stop(ctx.currentTime + 2);
  } catch (err) {
    console.error("Could not play scary sound", err);
  }
}

export function ScaryOverlay() {
  const { scareTriggered, clearScare } = useSocket();

  useEffect(() => {
    if (scareTriggered) {
      playScarySound();
      if ("vibrate" in navigator) {
        navigator.vibrate([500, 100, 500, 100, 1000]);
      }
    }
  }, [scareTriggered]);

  return (
    <AnimatePresence>
      {scareTriggered && (
        <motion.div
          initial={{ opacity: 0, scale: 1.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black cursor-pointer"
          onClick={clearScare}
          data-testid="scary-overlay"
        >
          <img 
            src={scaryFace} 
            alt="Scary Face" 
            className="w-full h-full object-cover animate-flicker pointer-events-none"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
