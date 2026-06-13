import {
  createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback,
} from "react";
import { io, Socket } from "socket.io-client";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

// ── Types ──────────────────────────────────────────────────────────────────
export interface SocketParticipant {
  id: string; name: string; isMuted: boolean;
  isOwner: boolean; isRM: boolean; isSpeaking: boolean;
  isRoomCreator?: boolean;
}

export interface RoomInfo {
  id: string; displayName: string; createdBy: string;
  hasPassword: boolean;
  createdAt: number; expiresAt: number; participantCount: number;
}

export interface UserEntry { name: string; credits: number; online: boolean; }

interface SocketContextState {
  socket:        Socket | null;
  isConnected:   boolean;
  // Identity
  myName:        string;
  participantId: string | null;
  isOwner:       boolean;
  isRM:          boolean;
  credits:       number;   // -1 = unlimited
  // Lobby
  rooms:         RoomInfo[];
  // In-room
  currentRoomId:     string | null;
  currentRoomCreator: string | null;
  participants:      SocketParticipant[];
  isForceMuted:      boolean;
  scareTriggered:    boolean;
  flashlightOn:      boolean;
  // Screen share
  remoteScreenFromId: string | null;
  // Stealth
  isStealthMode: boolean;
  // Actions
  registerUser:     (name: string, secret?: string) => void;
  refreshRooms:     () => void;
  createRoom:       (displayName: string, password?: string) => void;
  joinVoiceRoom:    (roomId: string, password?: string, stealthy?: boolean) => void;
  leaveVoiceRoom:   () => void;
  setSelfMuted:     (muted: boolean) => void;
  setSpeaking:      (speaking: boolean) => void;
  ownerMute:        (targetId: string, muted: boolean) => void;
  ownerKick:        (targetId: string) => void;
  ownerScare:       (targetId: string) => void;
  ownerFlashlight:  (targetId: string, on: boolean) => void;
  ownerDeleteRoom:  (roomId: string) => void;
  addCredits:       (targetName: string, amount: number) => void;
  getUsers:         () => void;
  userList:         UserEntry[];
  clearScare:       () => void;
  lastRoomError:    string | null;
  clearRoomError:   () => void;
  toggleStealth:    () => void;
  signalScreenShare:(sharing: boolean) => void;
}

const SocketContext = createContext<SocketContextState | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket]               = useState<Socket | null>(null);
  const [isConnected, setIsConnected]     = useState(false);
  const [myName, setMyName]               = useState("");
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [isOwner, setIsOwner]             = useState(false);
  const [isRM, setIsRM]                   = useState(false);
  const [credits, setCredits]             = useState(0);
  const [rooms, setRooms]                 = useState<RoomInfo[]>([]);
  const [currentRoomId, setCurrentRoomId]       = useState<string | null>(null);
  const [currentRoomCreator, setCurrentRoomCreator] = useState<string | null>(null);
  const [participants, setParticipants]   = useState<SocketParticipant[]>([]);
  const [isForceMuted, setIsForceMuted]   = useState(false);
  const [scareTriggered, setScareTriggered] = useState(false);
  const [flashlightOn, setFlashlightOn]   = useState(false);
  const [userList, setUserList]           = useState<UserEntry[]>([]);
  const [lastRoomError, setLastRoomError] = useState<string | null>(null);
  const [isStealthMode, setIsStealthMode] = useState(false);
  const [remoteScreenFromId, setRemoteScreenFromId] = useState<string | null>(null);

  const regDataRef  = useRef<{ name: string; secret?: string } | null>(null);
  const inRoomRef   = useRef<string | null>(null);

  const { toast }       = useToast();
  const [, setLocation] = useLocation();

  useEffect(() => {
    const sock = io({
      path: "/api/socket.io",
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
    setSocket(sock);

    sock.on("connect", () => {
      setIsConnected(true);
      setParticipantId(sock.id ?? null);
      if (regDataRef.current) sock.emit("register", regDataRef.current);
    });

    sock.on("disconnect", reason => {
      setIsConnected(false);
      if (reason === "io client disconnect") {
        regDataRef.current = null;
        inRoomRef.current  = null;
      }
    });

    // ── Identity ───────────────────────────────────────────────────────
    sock.on("registered", (d: { name: string; isOwner: boolean; isRM: boolean; credits: number | null }) => {
      setMyName(d.name);
      setIsOwner(d.isOwner);
      setIsRM(d.isRM);
      setCredits(d.credits === null ? -1 : d.credits);
      if (inRoomRef.current) {
        sock.emit("join-room", { roomId: inRoomRef.current });
      } else {
        setLocation("/lobby");
      }
    });

    sock.on("register-error", (d: { message: string }) =>
      toast({ title: d.message, variant: "destructive" }));

    // ── Lobby ──────────────────────────────────────────────────────────
    sock.on("rooms-list", (d: { rooms: RoomInfo[] }) =>
      setRooms(d.rooms.filter(r => r.expiresAt > Date.now())));

    sock.on("new-room",     (d: { room: RoomInfo })                             => setRooms(p => [...p.filter(r => r.id !== d.room.id), d.room]));
    sock.on("room-updated", (d: { roomId: string; participantCount: number })   => setRooms(p => p.map(r => r.id === d.roomId ? { ...r, participantCount: d.participantCount } : r)));
    sock.on("room-removed", (d: { roomId: string })                             => setRooms(p => p.filter(r => r.id !== d.roomId)));
    sock.on("room-created", () => { /* room-joined follows automatically */ });

    sock.on("delete-room-result", (d: { success: boolean; message: string }) =>
      toast({ title: d.message, variant: d.success ? "default" : "destructive" }));

    sock.on("room-error", (d: { message: string }) => {
      setLastRoomError(d.message);
      if (d.message !== "NO_CREDITS" && d.message !== "WRONG_PASSWORD")
        toast({ title: d.message, variant: "destructive" });
    });

    // ── In-room ────────────────────────────────────────────────────────
    sock.on("room-joined", (d: { roomId: string; participants: SocketParticipant[]; createdBy: string }) => {
      setCurrentRoomId(d.roomId);
      setCurrentRoomCreator(d.createdBy);
      setParticipants(d.participants);
      inRoomRef.current = d.roomId;
      setLocation("/room");
    });

    sock.on("left-room", () => {
      setCurrentRoomId(null);
      setCurrentRoomCreator(null);
      setParticipants([]);
      inRoomRef.current = null;
      setRemoteScreenFromId(null);
      setLocation("/lobby");
    });

    sock.on("room-expired", () => {
      setCurrentRoomId(null);
      setCurrentRoomCreator(null);
      setParticipants([]);
      inRoomRef.current = null;
      setRemoteScreenFromId(null);
      toast({ title: "Room expired (24h)", variant: "destructive" });
      setLocation("/lobby");
    });

    sock.on("participant-joined",   (p: SocketParticipant) =>
      setParticipants(prev => [...prev.filter(x => x.id !== p.id), p]));
    sock.on("participant-left",     (d: { participantId: string }) =>
      setParticipants(prev => prev.filter(x => x.id !== d.participantId)));
    sock.on("participant-muted",    (d: { participantId: string; isMuted: boolean }) =>
      setParticipants(prev => prev.map(p => p.id === d.participantId ? { ...p, isMuted: d.isMuted } : p)));
    sock.on("participant-speaking", (d: { participantId: string; isSpeaking: boolean }) =>
      setParticipants(prev => prev.map(p => p.id === d.participantId ? { ...p, isSpeaking: d.isSpeaking } : p)));

    sock.on("credits-updated", (d: { credits: number }) => setCredits(d.credits));
    sock.on("force-mute",      (d: { muted: boolean })  => {
      setIsForceMuted(d.muted);
      toast({ title: d.muted ? "Muted by owner" : "Unmuted by owner", variant: d.muted ? "destructive" : "default" });
    });
    sock.on("scare",      ()                 => setScareTriggered(true));
    sock.on("flashlight", (d: { on: boolean }) => setFlashlightOn(d.on));
    sock.on("kicked", () => {
      inRoomRef.current = null;
      setCurrentRoomId(null); setCurrentRoomCreator(null); setParticipants([]);
      setRemoteScreenFromId(null);
      toast({ title: "You were kicked", variant: "destructive" });
      setLocation("/lobby");
    });

    sock.on("users-list", (d: { users: UserEntry[] }) => setUserList(d.users));
    sock.on("credits-add-result", (d: { success: boolean; message: string }) =>
      toast({ title: d.success ? "Credits added ✓" : "Failed", description: d.message, variant: d.success ? "default" : "destructive" }));

    // Screen share signals
    sock.on("screen-share-started", (d: { fromId: string }) => setRemoteScreenFromId(d.fromId));
    sock.on("screen-share-stopped", ()                       => setRemoteScreenFromId(null));

    sock.connect();
    return () => { sock.disconnect(); };
  }, [setLocation, toast]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const registerUser    = useCallback((name: string, secret?: string) => {
    if (!socket) return;
    const data = { name, secret };
    regDataRef.current = data;
    socket.emit("register", data);
  }, [socket]);

  const refreshRooms    = useCallback(() => socket?.emit("get-rooms"), [socket]);
  const createRoom      = useCallback((d: string, pw?: string) => socket?.emit("create-room", { displayName: d, password: pw }), [socket]);
  const joinVoiceRoom   = useCallback((roomId: string, pw?: string, stealthy?: boolean) =>
    socket?.emit("join-room", { roomId, password: pw, stealthy: !!stealthy }), [socket]);
  const leaveVoiceRoom  = useCallback(() => socket?.emit("leave-room"), [socket]);
  const setSelfMuted    = useCallback((m: boolean) => socket?.emit("self-mute", { muted: m }), [socket]);
  const setSpeaking     = useCallback((s: boolean) => socket?.emit("speaking", { isSpeaking: s }), [socket]);
  const ownerMute       = useCallback((t: string, m: boolean) => socket?.emit("owner-mute", { targetId: t, muted: m }), [socket]);
  const ownerKick       = useCallback((t: string) => socket?.emit("owner-kick", { targetId: t }), [socket]);
  const ownerScare      = useCallback((t: string) => socket?.emit("owner-scare", { targetId: t }), [socket]);
  const ownerFlashlight = useCallback((t: string, on: boolean) => socket?.emit("owner-flashlight", { targetId: t, on }), [socket]);
  const ownerDeleteRoom = useCallback((roomId: string) => socket?.emit("owner-delete-room", { roomId }), [socket]);
  const addCredits      = useCallback((n: string, a: number) => socket?.emit("add-credits", { targetName: n, amount: a }), [socket]);
  const getUsers        = useCallback(() => socket?.emit("get-users"), [socket]);
  const clearScare      = useCallback(() => setScareTriggered(false), []);
  const clearRoomError  = useCallback(() => setLastRoomError(null), []);
  const toggleStealth   = useCallback(() => setIsStealthMode(p => !p), []);
  const signalScreenShare = useCallback((sharing: boolean) =>
    socket?.emit(sharing ? "start-screen-share" : "stop-screen-share"), [socket]);

  return (
    <SocketContext.Provider value={{
      socket, isConnected,
      myName, participantId, isOwner, isRM, credits,
      rooms, currentRoomId, currentRoomCreator, participants,
      isForceMuted, scareTriggered, flashlightOn,
      remoteScreenFromId, isStealthMode,
      userList, lastRoomError,
      registerUser, refreshRooms, createRoom, joinVoiceRoom, leaveVoiceRoom,
      setSelfMuted, setSpeaking,
      ownerMute, ownerKick, ownerScare, ownerFlashlight, ownerDeleteRoom,
      addCredits, getUsers, clearScare, clearRoomError,
      toggleStealth, signalScreenShare,
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
