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
const OWNER_SECRET = process.env.OWNER_SECRET || "owner123";

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

    // WebRTC signaling
    socket.on(
      "offer",
      (data: { targetId: string; offer: RTCSessionDescriptionInit }) => {
        const from = participants.get(socket.id);
        if (!from) return;
        io.to(data.targetId).emit("offer", {
          fromId: socket.id,
          fromName: from.name,
          offer: data.offer,
        });
      },
    );

    socket.on(
      "answer",
      (data: { targetId: string; answer: RTCSessionDescriptionInit }) => {
        io.to(data.targetId).emit("answer", {
          fromId: socket.id,
          answer: data.answer,
        });
      },
    );

    socket.on(
      "ice-candidate",
      (data: { targetId: string; candidate: RTCIceCandidateInit }) => {
        io.to(data.targetId).emit("ice-candidate", {
          fromId: socket.id,
          candidate: data.candidate,
        });
      },
    );

    // Speaking indicator
    socket.on("speaking", (data: { isSpeaking: boolean }) => {
      const participant = participants.get(socket.id);
      if (!participant) return;
      participant.isSpeaking = data.isSpeaking;
      io.emit("participant-speaking", {
        participantId: socket.id,
        isSpeaking: data.isSpeaking,
      });
    });

    // Owner: mute/unmute a participant
    socket.on("owner-mute", (data: { targetId: string; muted: boolean }) => {
      const sender = participants.get(socket.id);
      if (!sender?.isOwner) {
        socket.emit("error", { message: "Not authorized" });
        return;
      }
      const target = participants.get(data.targetId);
      if (!target) return;
      target.isMuted = data.muted;
      io.to(data.targetId).emit("force-mute", { muted: data.muted });
      io.emit("participant-muted", {
        participantId: data.targetId,
        isMuted: data.muted,
      });
      logger.info(
        { targetId: data.targetId, muted: data.muted },
        "Owner muted participant",
      );
    });

    // Owner: trigger scary prank on a participant
    socket.on("owner-scare", (data: { targetId: string }) => {
      const sender = participants.get(socket.id);
      if (!sender?.isOwner) {
        socket.emit("error", { message: "Not authorized" });
        return;
      }
      io.to(data.targetId).emit("scare", {});
      logger.info({ targetId: data.targetId }, "Owner triggered scare");
    });

    // Owner: toggle flashlight on a participant's device
    socket.on(
      "owner-flashlight",
      (data: { targetId: string; on: boolean }) => {
        const sender = participants.get(socket.id);
        if (!sender?.isOwner) {
          socket.emit("error", { message: "Not authorized" });
          return;
        }
        io.to(data.targetId).emit("flashlight", { on: data.on });
        logger.info(
          { targetId: data.targetId, on: data.on },
          "Owner toggled flashlight",
        );
      },
    );

    // Owner: kick a participant
    socket.on("owner-kick", (data: { targetId: string }) => {
      const sender = participants.get(socket.id);
      if (!sender?.isOwner) {
        socket.emit("error", { message: "Not authorized" });
        return;
      }
      io.to(data.targetId).emit("kicked", {});
      const kicked = participants.get(data.targetId);
      logger.info(
        { targetId: data.targetId, name: kicked?.name },
        "Owner kicked participant",
      );
    });

    // Participant self-mute
    socket.on("self-mute", (data: { muted: boolean }) => {
      const participant = participants.get(socket.id);
      if (!participant) return;
      participant.isMuted = data.muted;
      io.emit("participant-muted", {
        participantId: socket.id,
        isMuted: data.muted,
      });
    });

    socket.on("disconnect", () => {
      const participant = participants.get(socket.id);
      participants.delete(socket.id);
      if (participant) {
        io.emit("participant-left", { participantId: socket.id });
        logger.info({ name: participant.name }, "Participant left room");
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
