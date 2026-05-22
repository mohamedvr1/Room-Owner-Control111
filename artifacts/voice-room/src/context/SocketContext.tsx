import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { io, Socket } from "socket.io-client";
import { Participant } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

interface SocketContextState {
  socket: Socket | null;
  participants: Participant[];
  participantId: string | null;
  isOwner: boolean;
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
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  const [scareTriggered, setScareTriggered] = useState(false);
  const [flashlightOn, setFlashlightOn] = useState(false);
  const [isForceMuted, setIsForceMuted] = useState(false);
  
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  useEffect(() => {
    const newSocket = io({ path: "/api/socket.io", autoConnect: false });
    setSocket(newSocket);

    newSocket.on("connect", () => setIsConnected(true));
    // On unexpected disconnect: mark offline but DON'T clear room state or redirect.
    // Socket.IO will auto-reconnect; on reconnect we stay on the room page.
    newSocket.on("disconnect", () => {
      setIsConnected(false);
    });

    newSocket.on("joined", (data: { participantId: string, isOwner: boolean, participants: Participant[] }) => {
      setParticipantId(data.participantId);
      setIsOwner(data.isOwner);
      setParticipants(data.participants);
      setLocation("/room");
    });

    newSocket.on("participant-joined", (p: Participant) => {
      setParticipants(prev => [...prev.filter(x => x.id !== p.id), p]);
    });

    newSocket.on("participant-left", ({ participantId }: { participantId: string }) => {
      setParticipants(prev => prev.filter(x => x.id !== participantId));
    });

    newSocket.on("participant-muted", ({ participantId, isMuted }: { participantId: string, isMuted: boolean }) => {
      setParticipants(prev => prev.map(p => p.id === participantId ? { ...p, isMuted } : p));
    });

    newSocket.on("participant-speaking", ({ participantId, isSpeaking }: { participantId: string, isSpeaking: boolean }) => {
      setParticipants(prev => prev.map(p => p.id === participantId ? { ...p, isSpeaking } : p));
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

    newSocket.on("flashlight", ({ on }: { on: boolean }) => {
      setFlashlightOn(on);
    });

    newSocket.on("kicked", () => {
      toast({
        title: "You have been kicked from the room.",
        variant: "destructive"
      });
      newSocket.disconnect();
      setLocation("/");
    });
    
    newSocket.on("error", (err: { message: string }) => {
      toast({
        title: "Error",
        description: err.message || "Something went wrong",
        variant: "destructive"
      });
    });

    newSocket.connect();

    return () => {
      newSocket.disconnect();
    };
  }, [setLocation, toast]);

  const joinRoom = (name: string, isOwnerReq: boolean, ownerSecret?: string) => {
    if (socket) {
      socket.emit("join", { name, isOwner: isOwnerReq, ownerSecret });
    }
  };

  const leaveRoom = () => {
    if (socket) {
      socket.emit("leave");
      socket.disconnect();
      setParticipantId(null);
      setParticipants([]);
      setIsOwner(false);
      setLocation("/");
      socket.connect(); // reconnect for next time
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
      socket, participants, participantId, isOwner, isConnected,
      joinRoom, leaveRoom, setSelfMuted, setSpeaking,
      ownerMute, ownerScare, ownerFlashlight, ownerKick,
      scareTriggered, flashlightOn, isForceMuted, clearScare
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
