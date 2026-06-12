import { Server as SocketIOServer, Socket } from "socket.io";
import { logger } from "./lib/logger";

interface Participant {
  id: string;
  name: string;
  isMuted: boolean;
  isOwner: boolean;
  isRM: boolean;
  isSpeaking: boolean;
  socketId: string;
}

const participants = new Map<string, Participant>();
const OWNER_SECRET = process.env.OWNER_SECRET || "147147";
const SUPER_SECRET = process.env.SUPER_SECRET || "1471471";
const ROOM = "main";

// Rate limiting: track recent events per socket
const eventCounters = new Map<string, { count: number; resetAt: number }>();
function rateLimit(socketId: string, limit = 30): boolean {
  const now = Date.now();
  const entry = eventCounters.get(socketId);
  if (!entry || now > entry.resetAt) {
    eventCounters.set(socketId, { count: 1, resetAt: now + 1000 });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

function sanitize(p: Participant) {
  return {
    id: p.id,
    name: p.name,
    isMuted: p.isMuted,
    isOwner: p.isOwner,
    isRM: p.isRM,
    isSpeaking: p.isSpeaking,
  };
}

export function setupSocketIO(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    logger.info({ socketId: socket.id }, "Client connected");

    // ── Join ──────────────────────────────────────────────────────────────
    socket.on("join", (data: { name?: string; ownerSecret?: string }) => {
      if (!rateLimit(socket.id, 5)) {
        socket.emit("error", { message: "Too many requests" });
        return;
      }

      const name = String(data.name ?? "").trim().slice(0, 32) || "Ghost";
      const isRM    = data.ownerSecret === SUPER_SECRET;
      const isOwner = !isRM && data.ownerSecret === OWNER_SECRET;

      const participant: Participant = {
        id: socket.id,
        name,
        isMuted: false,
        isOwner,
        isRM,
        isSpeaking: false,
        socketId: socket.id,
      };

      participants.set(socket.id, participant);
      socket.join(ROOM);

      socket.emit("joined", {
        participantId: socket.id,
        isOwner,
        isRM,
        participants: Array.from(participants.values()).map(sanitize),
      });

      socket.broadcast.emit("participant-joined", sanitize(participant));
      logger.info({ name, isOwner, isRM }, "Participant joined");
    });

    // ── WebRTC signalling (pure relay — server never touches audio) ───────
    socket.on("rtc-offer", (d: { targetId: string; sdp: unknown }) => {
      if (!rateLimit(socket.id, 20)) return;
      socket.to(d.targetId).emit("rtc-offer", { fromId: socket.id, sdp: d.sdp });
    });

    socket.on("rtc-answer", (d: { targetId: string; sdp: unknown }) => {
      if (!rateLimit(socket.id, 20)) return;
      socket.to(d.targetId).emit("rtc-answer", { fromId: socket.id, sdp: d.sdp });
    });

    socket.on("rtc-ice", (d: { targetId: string; candidate: unknown }) => {
      if (!rateLimit(socket.id, 100)) return;
      socket.to(d.targetId).emit("rtc-ice", { fromId: socket.id, candidate: d.candidate });
    });

    // ── Speaking VAD ──────────────────────────────────────────────────────
    socket.on("speaking", (d: { isSpeaking: boolean }) => {
      if (!rateLimit(socket.id, 20)) return;
      const p = participants.get(socket.id);
      if (!p) return;
      p.isSpeaking = d.isSpeaking;
      io.emit("participant-speaking", { participantId: socket.id, isSpeaking: d.isSpeaking });
    });

    // ── Owner controls ────────────────────────────────────────────────────
    socket.on("owner-mute", (d: { targetId: string; muted: boolean }) => {
      const sender = participants.get(socket.id);
      if (!sender?.isOwner) { socket.emit("error", { message: "Not authorized" }); return; }
      const target = participants.get(d.targetId);
      if (!target) return;
      target.isMuted = d.muted;
      io.to(d.targetId).emit("force-mute", { muted: d.muted });
      io.emit("participant-muted", { participantId: d.targetId, isMuted: d.muted });
    });

    socket.on("owner-kick", (d: { targetId: string }) => {
      const sender = participants.get(socket.id);
      if (!sender?.isOwner) { socket.emit("error", { message: "Not authorized" }); return; }
      io.to(d.targetId).emit("kicked", {});
    });

    socket.on("owner-scare", (d: { targetId: string }) => {
      const sender = participants.get(socket.id);
      if (!sender?.isOwner) { socket.emit("error", { message: "Not authorized" }); return; }
      io.to(d.targetId).emit("scare", {});
    });

    socket.on("owner-flashlight", (d: { targetId: string; on: boolean }) => {
      const sender = participants.get(socket.id);
      if (!sender?.isOwner) { socket.emit("error", { message: "Not authorized" }); return; }
      io.to(d.targetId).emit("flashlight", { on: d.on });
    });

    socket.on("self-mute", (d: { muted: boolean }) => {
      const p = participants.get(socket.id);
      if (!p) return;
      p.isMuted = d.muted;
      io.emit("participant-muted", { participantId: socket.id, isMuted: d.muted });
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      const p = participants.get(socket.id);
      participants.delete(socket.id);
      eventCounters.delete(socket.id);
      if (p) {
        io.emit("participant-left", { participantId: socket.id });
        logger.info({ name: p.name }, "Participant left");
      }
    });
  });
}
