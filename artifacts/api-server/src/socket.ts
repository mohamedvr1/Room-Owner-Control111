import { Server as SocketIOServer, Socket } from "socket.io";
import { logger } from "./lib/logger";

interface Participant {
  id: string;
  name: string;
  isMuted: boolean;
  isOwner: boolean;
  isRM: boolean;
  isSpeaking: boolean;
  borderStyle: string;
  socketId: string;
}

const participants = new Map<string, Participant>();
const OWNER_SECRET = process.env.OWNER_SECRET || "147147";
const SUPER_SECRET = process.env.SUPER_SECRET || "1471471";
const ROOM = "main";

function sanitize(p: Participant) {
  return {
    id: p.id,
    name: p.name,
    isMuted: p.isMuted,
    isOwner: p.isOwner,
    isRM: p.isRM,
    isSpeaking: p.isSpeaking,
    borderStyle: p.borderStyle,
  };
}

export function setupSocketIO(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    logger.info({ socketId: socket.id }, "Client connected");

    socket.on(
      "join",
      (data: {
        name: string;
        isOwner?: boolean;
        ownerSecret?: string;
        borderStyle?: string;
      }) => {
        const isRM = data.ownerSecret === SUPER_SECRET;
        const isOwner = data.ownerSecret === OWNER_SECRET;

        const participant: Participant = {
          id: socket.id,
          name: data.name || "Anonymous",
          isMuted: false,
          isOwner,
          isRM,
          isSpeaking: false,
          borderStyle: data.borderStyle || "default",
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

        logger.info({ name: participant.name, isOwner, isRM }, "Participant joined room");
      },
    );

    // ── PCM audio relay (zero-gap, continuous stream) ──────────────────────
    socket.on("audio-pcm", (data: Buffer) => {
      socket.to(ROOM).emit("audio-pcm", { fromId: socket.id, data });
    });

    // ── Speaking indicator ─────────────────────────────────────────────────
    socket.on("speaking", (d: { isSpeaking: boolean }) => {
      const p = participants.get(socket.id);
      if (!p) return;
      p.isSpeaking = d.isSpeaking;
      io.emit("participant-speaking", { participantId: socket.id, isSpeaking: d.isSpeaking });
    });

    // ── Owner: mute ────────────────────────────────────────────────────────
    socket.on("owner-mute", (d: { targetId: string; muted: boolean }) => {
      const sender = participants.get(socket.id);
      if (!sender?.isOwner) { socket.emit("error", { message: "Not authorized" }); return; }
      const target = participants.get(d.targetId);
      if (!target) return;
      target.isMuted = d.muted;
      io.to(d.targetId).emit("force-mute", { muted: d.muted });
      io.emit("participant-muted", { participantId: d.targetId, isMuted: d.muted });
    });

    // ── Owner: scare ───────────────────────────────────────────────────────
    socket.on("owner-scare", (d: { targetId: string }) => {
      const sender = participants.get(socket.id);
      if (!sender?.isOwner) { socket.emit("error", { message: "Not authorized" }); return; }
      io.to(d.targetId).emit("scare", {});
    });

    // ── Owner: flashlight ──────────────────────────────────────────────────
    socket.on("owner-flashlight", (d: { targetId: string; on: boolean }) => {
      const sender = participants.get(socket.id);
      if (!sender?.isOwner) { socket.emit("error", { message: "Not authorized" }); return; }
      io.to(d.targetId).emit("flashlight", { on: d.on });
    });

    // ── Owner: kick ────────────────────────────────────────────────────────
    socket.on("owner-kick", (d: { targetId: string }) => {
      const sender = participants.get(socket.id);
      if (!sender?.isOwner) { socket.emit("error", { message: "Not authorized" }); return; }
      io.to(d.targetId).emit("kicked", {});
    });

    // ── Self-mute ──────────────────────────────────────────────────────────
    socket.on("self-mute", (d: { muted: boolean }) => {
      const p = participants.get(socket.id);
      if (!p) return;
      p.isMuted = d.muted;
      io.emit("participant-muted", { participantId: socket.id, isMuted: d.muted });
    });

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      const p = participants.get(socket.id);
      participants.delete(socket.id);
      if (p) {
        io.emit("participant-left", { participantId: socket.id });
        logger.info({ name: p.name }, "Participant left room");
      }
    });
  });
}
