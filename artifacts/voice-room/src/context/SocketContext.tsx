import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { io, Socket } from "socket.io-client";
import { Participant } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

export type SocketParticipant = Participant & { isSuperOwner?: boolean };

interface JoinData {
  name: string;
  isOwner: boolean;
  ownerSecret?: string;
}

interface SocketContextState {
  socket: Socket | null;
  participants: SocketParticipant[];
  participantId: string | null;
  isOwner: boolean;
  isSuperOwner: boolean;
  isConnected: boolean;
  joinRoom: (name: string, isOwner: boolean, ownerSecret?: string) => void;
  leaveRoom: () => void;
  setSelfMuted: (muted: boolean) => void;
  setSpeaking: (isSpeaking: boolean) => void;
  ownerMute: (targetId: string, muted: boolean) => void;
  ownerScare: (targetId: string) => void;
  ownerFlashlight: (targetId: string, on: boolean) => void;
  ownerKick: (targetId: string) => void;
  scareTriggered: boolean;
  flashlightOn: boolean;
  isForceMuted: boolean;
  clearScare: () => void;
}

const SocketContext = createContext<SocketContextState | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [participants, setParticipants] = useState<SocketParticipant[]>([]);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [isSuperOwner, setIsSuperOwner] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [scareTriggered, setScareTriggered] = useState(false);
  const [flashlightOn, setFlashlightOn] = useState(false);
  const [isForceMuted, setIsForceMuted] = useState(false);

  // Stored join data so we can auto-rejoin after reconnect
  const joinDataRef = useRef<JoinData | null>(null);
  // Track if we need to stay on room page (don't redirect on rejoin)
  const inRoomRef = useRef(false);

  const { toast } = useToast();
  const [, setLocation] = useLocation();

  useEffect(() => {
    const newSocket = io({
      path: "/api/socket.io",
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    setSocket(newSocket);

    newSocket.on("connect", () => {
      setIsConnected(true);
      // Auto-rejoin if we were in a room before an unexpected disconnect
      if (joinDataRef.current && inRoomRef.current) {
        newSocket.emit("join", joinDataRef.current);
      }
    });

    // On unexpected disconnect: don't clear state or redirect — Socket.IO reconnects automatically
    newSocket.on("disconnect", (reason) => {
      setIsConnected(false);
      // Only clear room state on deliberate disconnect (transport close by us)
      if (reason === "io client disconnect") {
        inRoomRef.current = false;
      }
    });

    newSocket.on("joined", (data: {
      participantId: string;
      isOwner: boolean;
      isSuperOwner: boolean;
      participants: SocketParticipant[];
    }) => {
      setParticipantId(data.participantId);
      setIsOwner(data.isOwner);
      setIsSuperOwner(data.isSuperOwner ?? false);
      setParticipants(data.participants);
      inRoomRef.current = true;
      setLocation("/room");
    });

    newSocket.on("participant-joined", (p: SocketParticipant) => {
      setParticipants(prev => [...prev.filter(x => x.id !== p.id), p]);
    });

    newSocket.on("participant-left", ({ participantId: pid }: { participantId: string }) => {
      setParticipants(prev => prev.filter(x => x.id !== pid));
    });

    newSocket.on("participant-muted", ({ participantId: pid, isMuted }: { participantId: string; isMuted: boolean }) => {
      setParticipants(prev => prev.map(p => p.id === pid ? { ...p, isMuted } : p));
    });

    newSocket.on("participant-speaking", ({ participantId: pid, isSpeaking }: { participantId: string; isSpeaking: boolean }) => {
      setParticipants(prev => prev.map(p => p.id === pid ? { ...p, isSpeaking } : p));
    });

    newSocket.on("force-mute", ({ muted }: { muted: boolean }) => {
      setIsForceMuted(muted);
      toast({
        title: muted ? "تم كتم صوتك من قبل الأونر" : "تم رفع كتم صوتك",
        variant: muted ? "destructive" : "default",
      });
    });

    newSocket.on("scare", () => {
      setScareTriggered(true);
      setTimeout(() => setScareTriggered(false), 4000);
    });

    newSocket.on("flashlight", ({ on }: { on: boolean }) => setFlashlightOn(on));

    newSocket.on("kicked", () => {
      joinDataRef.current = null;
      inRoomRef.current = false;
      toast({ title: "تم طردك من الروم.", variant: "destructive" });
      newSocket.disconnect();
      setParticipantId(null);
      setParticipants([]);
      setIsOwner(false);
      setIsSuperOwner(false);
      setLocation("/");
      setTimeout(() => newSocket.connect(), 100);
    });

    newSocket.on("error", (err: { message: string }) => {
      toast({ title: "Error", description: err.message || "Something went wrong", variant: "destructive" });
    });

    newSocket.connect();
    return () => { newSocket.disconnect(); };
  }, [setLocation, toast]);

  const joinRoom = (name: string, isOwnerReq: boolean, ownerSecret?: string) => {
    if (socket) {
      const data: JoinData = { name, isOwner: isOwnerReq, ownerSecret };
      joinDataRef.current = data;
      socket.emit("join", data);
    }
  };

  const leaveRoom = () => {
    if (socket) {
      joinDataRef.current = null;
      inRoomRef.current = false;
      socket.emit("leave");
      socket.disconnect();
      setParticipantId(null);
      setParticipants([]);
      setIsOwner(false);
      setIsSuperOwner(false);
      setLocation("/");
      setTimeout(() => socket.connect(), 100);
    }
  };

  const setSelfMuted = (muted: boolean) => socket?.emit("self-mute", { muted });
  const setSpeaking = (isSpeaking: boolean) => socket?.emit("speaking", { isSpeaking });
  const ownerMute = (targetId: string, muted: boolean) => socket?.emit("owner-mute", { targetId, muted });
  const ownerScare = (targetId: string) => socket?.emit("owner-scare", { targetId });
  const ownerFlashlight = (targetId: string, on: boolean) => socket?.emit("owner-flashlight", { targetId, on });
  const ownerKick = (targetId: string) => socket?.emit("owner-kick", { targetId });
  const clearScare = () => setScareTriggered(false);

  return (
    <SocketContext.Provider value={{
      socket, participants, participantId, isOwner, isSuperOwner, isConnected,
      joinRoom, leaveRoom, setSelfMuted, setSpeaking,
      ownerMute, ownerScare, ownerFlashlight, ownerKick,
      scareTriggered, flashlightOn, isForceMuted, clearScare,
    }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used within a SocketProvider");
  return ctx;
}
