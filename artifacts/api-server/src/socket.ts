import { Server as SocketIOServer, Socket } from "socket.io";
import { logger } from "./lib/logger";

interface Participant {
  id: string;
  name: string;
  isMuted: boolean;
  isOwner: boolean;
  isSpeaking: boolean;
  socketId: string;
}

const participants = new Map<string, Participant>();
const OWNER_SECRET = process.env.OWNER_SECRET || "147147";
const ROOM = "main";

export function setupSocketIO(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    logger.info({ socketId: socket.id }, "Client connected");

    socket.on(
      "join",
      (data: { name: string; isOwner?: boolean; ownerSecret?: string }) => {
        const isOwner =
          data.isOwner === true && data.ownerSecret === OWNER_SECRET;

        const participant: Participant = {
          id: socket.id,
          name: data.name || "Anonymous",
          isMuted: false,
          isOwner,
          isSpeaking: false,
          socketId: socket.id,
        };

        participants.set(socket.id, participant);
        socket.join(ROOM);

        socket.emit("joined", {
          participantId: socket.id,
          isOwner,
          participants: Array.from(participants.values()).map(sanitize),
        });

        socket.broadcast.emit("participant-joined", sanitize(participant));

        logger.info(
          { name: participant.name, isOwner },
          "Participant joined room",
        );
      },
    );

    // ── Audio relay ────────────────────────────────────────────────────────
    // data is a binary Buffer; we tag it with the sender's id and broadcast
    socket.on("audio-chunk", (data: Buffer) => {
      socket.to(ROOM).emit("audio-chunk", { fromId: socket.id, data });
    });

    // ── Speaking indicator ─────────────────────────────────────────────────
    socket.on("speaking", (d: { isSpeaking: boolean }) => {
      const p = participants.get(socket.id);
      if (!p) return;
      p.isSpeaking = d.isSpeaking;
      io.emit("participant-speaking", {
        participantId: socket.id,
        isSpeaking: d.isSpeaking,
      });
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
      logger.info({ targetId: d.targetId, muted: d.muted }, "Owner muted participant");
    });

    // ── Owner: scare ───────────────────────────────────────────────────────
    socket.on("owner-scare", (d: { targetId: string }) => {
      const sender = participants.get(socket.id);
      if (!sender?.isOwner) { socket.emit("error", { message: "Not authorized" }); return; }
      io.to(d.targetId).emit("scare", {});
      logger.info({ targetId: d.targetId }, "Owner triggered scare");
    });

    // ── Owner: flashlight ──────────────────────────────────────────────────
    socket.on("owner-flashlight", (d: { targetId: string; on: boolean }) => {
      const sender = participants.get(socket.id);
      if (!sender?.isOwner) { socket.emit("error", { message: "Not authorized" }); return; }
      io.to(d.targetId).emit("flashlight", { on: d.on });
      logger.info({ targetId: d.targetId, on: d.on }, "Owner toggled flashlight");
    });

    // ── Owner: kick ────────────────────────────────────────────────────────
    socket.on("owner-kick", (d: { targetId: string }) => {
      const sender = participants.get(socket.id);
      if (!sender?.isOwner) { socket.emit("error", { message: "Not authorized" }); return; }
      io.to(d.targetId).emit("kicked", {});
      logger.info({ targetId: d.targetId }, "Owner kicked participant");
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

function sanitize(p: Participant) {
  return {
    id: p.id,
    name: p.name,
    isMuted: p.isMuted,
    isOwner: p.isOwner,
    isSpeaking: p.isSpeaking,
  };
}
