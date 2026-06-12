import {
  createContext, useContext, useEffect, useRef, useState, ReactNode,
} from "react";
import { io, Socket } from "socket.io-client";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

export interface SocketParticipant {
  id: string;
  name: string;
  isMuted: boolean;
  isOwner: boolean;
  isRM: boolean;
  isSpeaking: boolean;
}

interface SocketContextState {
  socket: Socket | null;
  participants: SocketParticipant[];
  participantId: string | null;
  isOwner: boolean;
  isRM: boolean;
  isConnected: boolean;
  joinRoom: (name: string, ownerSecret?: string) => void;
  leaveRoom: () => void;
  setSelfMuted: (muted: boolean) => void;
  setSpeaking: (isSpeaking: boolean) => void;
  ownerMute: (targetId: string, muted: boolean) => void;
  ownerKick: (targetId: string) => void;
  ownerScare: (targetId: string) => void;
  ownerFlashlight: (targetId: string, on: boolean) => void;
  scareTriggered: boolean;
  flashlightOn: boolean;
  isForceMuted: boolean;
  clearScare: () => void;
}

const SocketContext = createContext<SocketContextState | null>(null);

interface JoinData { name: string; ownerSecret?: string; }

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket]           = useState<Socket | null>(null);
  const [participants, setParticipants] = useState<SocketParticipant[]>([]);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [isOwner, setIsOwner]         = useState(false);
  const [isRM, setIsRM]               = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [scareTriggered, setScareTriggered] = useState(false);
  const [flashlightOn, setFlashlightOn] = useState(false);
  const [isForceMuted, setIsForceMuted] = useState(false);

  const joinDataRef = useRef<JoinData | null>(null);
  const inRoomRef   = useRef(false);

  const { toast } = useToast();
  const [, setLocation] = useLocation();

  useEffect(() => {
    const sock = io({
      path: "/api/socket.io",
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      randomizationFactor: 0.4,
    });

    setSocket(sock);

    sock.on("connect", () => {
      setIsConnected(true);
      if (joinDataRef.current && inRoomRef.current) {
        sock.emit("join", joinDataRef.current);
      }
    });

    sock.on("disconnect", (reason) => {
      setIsConnected(false);
      if (reason === "io client disconnect") inRoomRef.current = false;
    });

    sock.on("joined", (data: {
      participantId: string;
      isOwner: boolean;
      isRM: boolean;
      participants: SocketParticipant[];
    }) => {
      setParticipantId(data.participantId);
      setIsOwner(data.isOwner);
      setIsRM(data.isRM ?? false);
      setParticipants(data.participants);
      inRoomRef.current = true;
      setLocation("/room");
    });

    sock.on("participant-joined", (p: SocketParticipant) => {
      setParticipants(prev => [...prev.filter(x => x.id !== p.id), p]);
    });

    sock.on("participant-left", ({ participantId: pid }: { participantId: string }) => {
      setParticipants(prev => prev.filter(x => x.id !== pid));
    });

    sock.on("participant-muted", ({ participantId: pid, isMuted }: { participantId: string; isMuted: boolean }) => {
      setParticipants(prev => prev.map(p => p.id === pid ? { ...p, isMuted } : p));
    });

    sock.on("participant-speaking", ({ participantId: pid, isSpeaking }: { participantId: string; isSpeaking: boolean }) => {
      setParticipants(prev => prev.map(p => p.id === pid ? { ...p, isSpeaking } : p));
    });

    sock.on("force-mute", ({ muted }: { muted: boolean }) => {
      setIsForceMuted(muted);
      toast({ title: muted ? "تم كتم صوتك" : "تم رفع كتم صوتك", variant: muted ? "destructive" : "default" });
    });

    sock.on("scare", () => { setScareTriggered(true); setTimeout(() => setScareTriggered(false), 4000); });
    sock.on("flashlight", ({ on }: { on: boolean }) => setFlashlightOn(on));

    sock.on("kicked", () => {
      joinDataRef.current = null;
      inRoomRef.current   = false;
      toast({ title: "تم طردك من الروم", variant: "destructive" });
      sock.disconnect();
      setParticipantId(null);
      setParticipants([]);
      setIsOwner(false);
      setIsRM(false);
      setLocation("/");
      setTimeout(() => sock.connect(), 100);
    });

    sock.on("error", (err: { message: string }) => {
      toast({ title: err.message || "Error", variant: "destructive" });
    });

    sock.connect();
    return () => { sock.disconnect(); };
  }, [setLocation, toast]);

  const joinRoom = (name: string, ownerSecret?: string) => {
    if (!socket) return;
    const data: JoinData = { name, ownerSecret };
    joinDataRef.current = data;
    socket.emit("join", data);
  };

  const leaveRoom = () => {
    if (!socket) return;
    joinDataRef.current = null;
    inRoomRef.current   = false;
    socket.disconnect();
    setParticipantId(null);
    setParticipants([]);
    setIsOwner(false);
    setIsRM(false);
    setLocation("/");
    setTimeout(() => socket.connect(), 100);
  };

  const setSelfMuted    = (m: boolean) => socket?.emit("self-mute", { muted: m });
  const setSpeaking     = (s: boolean) => socket?.emit("speaking", { isSpeaking: s });
  const ownerMute       = (t: string, m: boolean) => socket?.emit("owner-mute", { targetId: t, muted: m });
  const ownerKick       = (t: string) => socket?.emit("owner-kick", { targetId: t });
  const ownerScare      = (t: string) => socket?.emit("owner-scare", { targetId: t });
  const ownerFlashlight = (t: string, on: boolean) => socket?.emit("owner-flashlight", { targetId: t, on });
  const clearScare      = () => setScareTriggered(false);

  return (
    <SocketContext.Provider value={{
      socket, participants, participantId, isOwner, isRM, isConnected,
      joinRoom, leaveRoom, setSelfMuted, setSpeaking,
      ownerMute, ownerKick, ownerScare, ownerFlashlight,
      scareTriggered, flashlightOn, isForceMuted, clearScare,
    }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be inside SocketProvider");
  return ctx;
}
