import { Server as SocketIOServer, Socket } from "socket.io";
import { randomUUID } from "crypto";
import { logger } from "./lib/logger";

// ── Types ──────────────────────────────────────────────────────────────────
interface UserProfile { credits: number; }

interface Participant {
  id: string; name: string; isMuted: boolean;
  isOwner: boolean; isRM: boolean; isSpeaking: boolean;
}

interface Room {
  id: string; displayName: string; createdBy: string;
  createdAt: number; expiresAt: number;
  participants: Map<string, Participant>;
}

// ── Constants ──────────────────────────────────────────────────────────────
const OWNER_SECRET = process.env.OWNER_SECRET || "147147";
const SUPER_SECRET = process.env.SUPER_SECRET || "1471471";
const ROOM_TTL     = 24 * 60 * 60 * 1000; // 24 h
const VR           = "vr:";               // socket.io room prefix

// ── Server-wide state ──────────────────────────────────────────────────────
const userProfiles  = new Map<string, UserProfile>();          // name → profile
const rooms         = new Map<string, Room>();                 // roomId → room
const socketToName  = new Map<string, string>();               // socketId → name
const socketToRoom  = new Map<string, string>();               // socketId → roomId
const activeSockets = new Map<string, string>();               // name → socketId
const socketRoles   = new Map<string, { isOwner: boolean; isRM: boolean }>(); // socketId → roles

// Rate limiting
const eventCounters = new Map<string, { count: number; resetAt: number }>();
function rateLimit(socketId: string, limit = 30): boolean {
  const now   = Date.now();
  const entry = eventCounters.get(socketId);
  if (!entry || now > entry.resetAt) { eventCounters.set(socketId, { count: 1, resetAt: now + 1000 }); return true; }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

function isOwner(socketId: string) { return socketRoles.get(socketId)?.isOwner ?? false; }
function isRM(socketId: string)    { return socketRoles.get(socketId)?.isRM    ?? false; }
function isPow(socketId: string)   { return isOwner(socketId) || isRM(socketId); }

function sanitizeP(p: Participant) {
  return { id: p.id, name: p.name, isMuted: p.isMuted, isOwner: p.isOwner, isRM: p.isRM, isSpeaking: p.isSpeaking };
}

function sanitizeRoom(r: Room) {
  return {
    id: r.id, displayName: r.displayName, createdBy: r.createdBy,
    createdAt: r.createdAt, expiresAt: r.expiresAt,
    participantCount: r.participants.size,
  };
}

function activeRooms() {
  const now = Date.now(); const out = [];
  for (const [id, r] of rooms) {
    if (r.expiresAt > now) out.push(sanitizeRoom(r));
    else rooms.delete(id);
  }
  return out;
}

export function setupSocketIO(io: SocketIOServer) {

  // ── Room-leave helper ───────────────────────────────────────────────────
  function leaveRoom(socket: Socket, roomId: string) {
    const room = rooms.get(roomId);
    if (!room) return;
    room.participants.delete(socket.id);
    socket.leave(VR + roomId);
    socketToRoom.delete(socket.id);
    socket.to(VR + roomId).emit("participant-left", { participantId: socket.id });
    io.emit("room-updated", { roomId, participantCount: room.participants.size });
  }

  // ── Expired room cleanup (every 60 s) ──────────────────────────────────
  setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
      if (room.expiresAt <= now) {
        for (const [sid] of room.participants) {
          io.to(sid).emit("room-expired", { roomId: id });
          socketToRoom.delete(sid);
        }
        rooms.delete(id);
        io.emit("room-removed", { roomId: id });
        logger.info({ roomId: id }, "Room expired");
      }
    }
  }, 60_000);

  // ── Connection ──────────────────────────────────────────────────────────
  io.on("connection", (socket: Socket) => {
    logger.info({ socketId: socket.id }, "Client connected");

    // ── register ──────────────────────────────────────────────────────────
    socket.on("register", (data: { name?: string; secret?: string }) => {
      if (!rateLimit(socket.id, 5)) return;

      const name = String(data.name ?? "").trim().slice(0, 32);
      if (!name) { socket.emit("register-error", { message: "Name required" }); return; }

      // Uniqueness: block if another active socket holds this name
      const existingSocketId = activeSockets.get(name);
      if (existingSocketId && existingSocketId !== socket.id && io.sockets.sockets.has(existingSocketId)) {
        socket.emit("register-error", { message: "This name is already taken — choose another" });
        return;
      }

      const ownerAuth = data.secret === OWNER_SECRET;
      const rmAuth    = data.secret === SUPER_SECRET;
      socketRoles.set(socket.id, { isOwner: ownerAuth, isRM: rmAuth });

      if (!userProfiles.has(name)) userProfiles.set(name, { credits: 0 });
      const profile = userProfiles.get(name)!;

      socketToName.set(socket.id, name);
      activeSockets.set(name, socket.id);

      socket.emit("registered", {
        name,
        isOwner: ownerAuth,
        isRM:    rmAuth,
        credits: ownerAuth || rmAuth ? null : profile.credits, // null = unlimited
      });

      logger.info({ name, isOwner: ownerAuth, isRM: rmAuth }, "User registered");
    });

    // ── get-rooms ─────────────────────────────────────────────────────────
    socket.on("get-rooms", () => {
      socket.emit("rooms-list", { rooms: activeRooms() });
    });

    // ── create-room ───────────────────────────────────────────────────────
    socket.on("create-room", async (data: { displayName?: string }) => {
      if (!rateLimit(socket.id, 3)) return;
      const name = socketToName.get(socket.id);
      if (!name) { socket.emit("room-error", { message: "Not registered" }); return; }

      const displayName = String(data.displayName ?? "").trim().slice(0, 48) || `${name}'s Room`;
      const profile     = userProfiles.get(name)!;
      const privileged  = isPow(socket.id);

      if (!privileged) {
        if (profile.credits < 1) {
          socket.emit("room-error", { message: "NO_CREDITS" }); return;
        }
        profile.credits -= 1;
        socket.emit("credits-updated", { credits: profile.credits });
      }

      const roomId = randomUUID().slice(0, 8);
      const now    = Date.now();
      const room: Room = {
        id: roomId, displayName, createdBy: name,
        createdAt: now, expiresAt: now + ROOM_TTL,
        participants: new Map(),
      };
      rooms.set(roomId, room);

      io.emit("new-room", { room: sanitizeRoom(room) });
      socket.emit("room-created", { roomId });
      logger.info({ roomId, displayName, createdBy: name }, "Room created");

      // Auto-join the room they just created
      const ownerRole = isOwner(socket.id);
      const rmRole    = isRM(socket.id);
      const p: Participant = { id: socket.id, name, isMuted: false, isOwner: ownerRole, isRM: rmRole, isSpeaking: false };
      room.participants.set(socket.id, p);
      socketToRoom.set(socket.id, roomId);
      await socket.join(VR + roomId);
      socket.emit("room-joined", { roomId, participants: [sanitizeP(p)] });
      io.emit("room-updated", { roomId, participantCount: 1 });
    });

    // ── join-room ─────────────────────────────────────────────────────────
    socket.on("join-room", async (data: { roomId?: string }) => {
      if (!rateLimit(socket.id, 5)) return;
      const name = socketToName.get(socket.id);
      if (!name) { socket.emit("room-error", { message: "Not registered" }); return; }

      const room = rooms.get(data.roomId ?? "");
      if (!room)               { socket.emit("room-error", { message: "Room not found" }); return; }
      if (room.expiresAt <= Date.now()) {
        rooms.delete(room.id);
        socket.emit("room-error", { message: "Room has expired" }); return;
      }

      // Leave current room first
      const curRoomId = socketToRoom.get(socket.id);
      if (curRoomId) leaveRoom(socket, curRoomId);

      const ownerRole = isOwner(socket.id);
      const rmRole    = isRM(socket.id);
      const p: Participant = { id: socket.id, name, isMuted: false, isOwner: ownerRole, isRM: rmRole, isSpeaking: false };

      room.participants.set(socket.id, p);
      socketToRoom.set(socket.id, room.id);
      await socket.join(VR + room.id);

      socket.emit("room-joined", {
        roomId: room.id,
        participants: Array.from(room.participants.values()).map(sanitizeP),
      });
      socket.to(VR + room.id).emit("participant-joined", sanitizeP(p));
      io.emit("room-updated", { roomId: room.id, participantCount: room.participants.size });
      logger.info({ name, roomId: room.id }, "User joined room");
    });

    // ── leave-room ────────────────────────────────────────────────────────
    socket.on("leave-room", () => {
      const roomId = socketToRoom.get(socket.id);
      if (roomId) leaveRoom(socket, roomId);
      socket.emit("left-room", {});
    });

    // ── WebRTC relay ──────────────────────────────────────────────────────
    socket.on("rtc-offer",  (d: { targetId: string; sdp: unknown }) => {
      if (!rateLimit(socket.id, 20)) return;
      socket.to(d.targetId).emit("rtc-offer",  { fromId: socket.id, sdp: d.sdp });
    });
    socket.on("rtc-answer", (d: { targetId: string; sdp: unknown }) => {
      if (!rateLimit(socket.id, 20)) return;
      socket.to(d.targetId).emit("rtc-answer", { fromId: socket.id, sdp: d.sdp });
    });
    socket.on("rtc-ice",    (d: { targetId: string; candidate: unknown }) => {
      if (!rateLimit(socket.id, 100)) return;
      socket.to(d.targetId).emit("rtc-ice",    { fromId: socket.id, candidate: d.candidate });
    });

    // ── Speaking VAD ──────────────────────────────────────────────────────
    socket.on("speaking", (d: { isSpeaking: boolean }) => {
      if (!rateLimit(socket.id, 20)) return;
      const roomId = socketToRoom.get(socket.id);
      const room   = roomId ? rooms.get(roomId) : null;
      const p      = room?.participants.get(socket.id);
      if (!p || !roomId) return;
      p.isSpeaking = d.isSpeaking;
      io.to(VR + roomId).emit("participant-speaking", { participantId: socket.id, isSpeaking: d.isSpeaking });
    });

    socket.on("self-mute", (d: { muted: boolean }) => {
      const roomId = socketToRoom.get(socket.id);
      const room   = roomId ? rooms.get(roomId) : null;
      const p      = room?.participants.get(socket.id);
      if (!p || !roomId) return;
      p.isMuted = d.muted;
      io.to(VR + roomId).emit("participant-muted", { participantId: socket.id, isMuted: d.muted });
    });

    // ── Owner controls ────────────────────────────────────────────────────
    socket.on("owner-mute", (d: { targetId: string; muted: boolean }) => {
      if (!isOwner(socket.id)) { socket.emit("error", { message: "Not authorized" }); return; }
      const roomId = socketToRoom.get(socket.id);
      const room   = roomId ? rooms.get(roomId) : null;
      const target = room?.participants.get(d.targetId);
      if (!target || !roomId) return;
      target.isMuted = d.muted;
      io.to(d.targetId).emit("force-mute", { muted: d.muted });
      io.to(VR + roomId).emit("participant-muted", { participantId: d.targetId, isMuted: d.muted });
    });

    socket.on("owner-kick", (d: { targetId: string }) => {
      if (!isOwner(socket.id)) { socket.emit("error", { message: "Not authorized" }); return; }
      io.to(d.targetId).emit("kicked", {});
    });

    socket.on("owner-scare", (d: { targetId: string }) => {
      if (!isOwner(socket.id)) { socket.emit("error", { message: "Not authorized" }); return; }
      io.to(d.targetId).emit("scare", {});
    });

    socket.on("owner-flashlight", (d: { targetId: string; on: boolean }) => {
      if (!isOwner(socket.id)) { socket.emit("error", { message: "Not authorized" }); return; }
      io.to(d.targetId).emit("flashlight", { on: d.on });
    });

    // ── Credits management (owner only) ───────────────────────────────────
    socket.on("add-credits", (d: { targetName?: string; amount?: number }) => {
      if (!isOwner(socket.id)) { socket.emit("error", { message: "Not authorized" }); return; }
      const targetName = String(d.targetName ?? "").trim();
      const amount     = Math.max(1, Math.min(10000, Math.floor(Number(d.amount) || 0)));
      if (!targetName || amount <= 0) {
        socket.emit("credits-add-result", { success: false, message: "Invalid input" }); return;
      }
      if (!userProfiles.has(targetName)) userProfiles.set(targetName, { credits: 0 });
      const profile = userProfiles.get(targetName)!;
      profile.credits += amount;

      socket.emit("credits-add-result", {
        success: true,
        message: `✓ Added ${amount} credits to "${targetName}" (new total: ${profile.credits})`,
        targetName,
        newCredits: profile.credits,
      });

      // Notify target if online
      const targetSocketId = activeSockets.get(targetName);
      if (targetSocketId && io.sockets.sockets.has(targetSocketId)) {
        io.to(targetSocketId).emit("credits-updated", { credits: profile.credits });
      }
      logger.info({ targetName, amount, newTotal: profile.credits }, "Credits added");
    });

    // ── get-users (owner only) ────────────────────────────────────────────
    socket.on("get-users", () => {
      if (!isOwner(socket.id)) return;
      const users = Array.from(userProfiles.entries()).map(([name, profile]) => ({
        name,
        credits: profile.credits,
        online: activeSockets.get(name) === activeSockets.get(name) && !!io.sockets.sockets.get(activeSockets.get(name) ?? ""),
      }));
      socket.emit("users-list", { users });
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      const name   = socketToName.get(socket.id);
      const roomId = socketToRoom.get(socket.id);
      if (roomId) leaveRoom(socket, roomId);
      if (name && activeSockets.get(name) === socket.id) activeSockets.delete(name);
      socketToName.delete(socket.id);
      socketRoles.delete(socket.id);
      eventCounters.delete(socket.id);
      logger.info({ name, socketId: socket.id }, "Client disconnected");
    });
  });
}
