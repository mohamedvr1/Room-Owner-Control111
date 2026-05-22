import { useEffect, useRef } from "react";
import { useSocket } from "../context/SocketContext";

export function useSpeakingDetection(localStream: MediaStream | null, muted: boolean) {
  const { setSpeaking } = useSocket();
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const requestRef = useRef<number>();
  const isSpeakingRef = useRef(false);

  useEffect(() => {
    if (!localStream || muted) {
      if (isSpeakingRef.current) {
        isSpeakingRef.current = false;
        setSpeaking(false);
      }
      return;
    }

    try {
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      
      const source = audioCtx.createMediaStreamSource(localStream);
      source.connect(analyser);
      sourceRef.current = source;
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      dataArrayRef.current = dataArray;

      const detectSound = () => {
        if (!analyserRef.current || !dataArrayRef.current) return;
        
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        
        let sum = 0;
        for (let i = 0; i < dataArrayRef.current.length; i++) {
          sum += dataArrayRef.current[i];
        }
        const average = sum / dataArrayRef.current.length;
        
        const threshold = 15; // Threshold for speaking
        const isSpeakingNow = average > threshold;
        
        if (isSpeakingNow !== isSpeakingRef.current) {
          isSpeakingRef.current = isSpeakingNow;
          setSpeaking(isSpeakingNow);
        }
        
        requestRef.current = requestAnimationFrame(detectSound);
      };
      
      detectSound();
    } catch (err) {
      console.error("Error setting up speaking detection", err);
    }

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
      }
    };
  }, [localStream, muted, setSpeaking]);
}
