import { useEffect, useRef, useCallback } from "react";
import { useSocket } from "../context/SocketContext";

// Free TURN servers via OpenRelay — required for cross-network connections
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:openrelay.metered.ca:80" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

interface PeerState {
  pc: RTCPeerConnection;
  pendingCandidates: RTCIceCandidateInit[];
  hasRemoteDesc: boolean;
  gainNode: GainNode;
}

export function useWebRTC(
  localStream: MediaStream | null,
  audioCtx: AudioContext | null,
) {
  const { socket, participantId } = useSocket();
  const peers = useRef<Map<string, PeerState>>(new Map());
  const outputMutedRef = useRef(false);
  // Keep a ref to localStream so callbacks always have latest value
  const localStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);

  // ─── Audio playback via AudioContext ─────────────────────────────────────
  const playStream = useCallback(
    (peerId: string, stream: MediaStream) => {
      if (!audioCtx) return;
      const state = peers.current.get(peerId);
      if (!state) return;

      try {
        const src = audioCtx.createMediaStreamSource(stream);
        src.connect(state.gainNode);
        state.gainNode.connect(audioCtx.destination);
        // Ensure context is running (resume if suspended after user interaction)
        if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      } catch {
        // Fallback: plain <audio> element
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.setAttribute("playsinline", "true");
        audio.muted = outputMutedRef.current;
        audio.srcObject = stream;
        document.body.appendChild(audio);
        audio.play().catch(() => {});
      }
    },
    [audioCtx],
  );

  // ─── Create / get peer connection ────────────────────────────────────────
  const getOrCreatePeer = useCallback(
    (peerId: string): PeerState => {
      const existing = peers.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const gainNode = audioCtx?.createGain() ?? ({} as GainNode);
      if (audioCtx && gainNode.gain) {
        gainNode.gain.value = outputMutedRef.current ? 0 : 1;
      }

      const state: PeerState = {
        pc,
        pendingCandidates: [],
        hasRemoteDesc: false,
        gainNode,
      };
      peers.current.set(peerId, state);

      // Send ICE candidates
      pc.onicecandidate = ({ candidate }) => {
        if (candidate && socket) {
          socket.emit("ice-candidate", { targetId: peerId, candidate });
        }
      };

      // Play incoming audio
      const remoteStream = new MediaStream();
      pc.ontrack = (e) => {
        e.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));
        playStream(peerId, remoteStream);
      };

      // Auto-restart ICE on failure
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") pc.restartIce();
      };

      // Add local tracks if available
      const stream = localStreamRef.current;
      if (stream) {
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      }

      return state;
    },
    [socket, audioCtx, playStream],
  );

  // ─── Drain queued ICE candidates ─────────────────────────────────────────
  const drainCandidates = useCallback(async (state: PeerState) => {
    while (state.pendingCandidates.length > 0) {
      const c = state.pendingCandidates.shift()!;
      try {
        await state.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {}
    }
  }, []);

  // ─── Socket event handlers ───────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    // New participant joined → WE create the offer
    const onParticipantJoined = async (p: { id: string }) => {
      if (p.id === participantId) return;
      const state = getOrCreatePeer(p.id);
      // Add local tracks if they weren't added yet (race condition guard)
      const stream = localStreamRef.current;
      if (stream && state.pc.getSenders().length === 0) {
        stream.getTracks().forEach((t) => state.pc.addTrack(t, stream));
      }
      const offer = await state.pc.createOffer();
      await state.pc.setLocalDescription(offer);
      socket.emit("offer", { targetId: p.id, offer });
    };

    // Received offer → send answer
    const onOffer = async ({
      fromId,
      offer,
    }: {
      fromId: string;
      offer: RTCSessionDescriptionInit;
    }) => {
      if (fromId === participantId) return;
      const state = getOrCreatePeer(fromId);
      // Add local tracks if not added yet
      const stream = localStreamRef.current;
      if (stream && state.pc.getSenders().length === 0) {
        stream.getTracks().forEach((t) => state.pc.addTrack(t, stream));
      }
      await state.pc.setRemoteDescription(new RTCSessionDescription(offer));
      state.hasRemoteDesc = true;
      await drainCandidates(state);
      const answer = await state.pc.createAnswer();
      await state.pc.setLocalDescription(answer);
      socket.emit("answer", { targetId: fromId, answer });
    };

    // Received answer
    const onAnswer = async ({
      fromId,
      answer,
    }: {
      fromId: string;
      answer: RTCSessionDescriptionInit;
    }) => {
      const state = peers.current.get(fromId);
      if (!state) return;
      if (state.pc.signalingState === "have-local-offer") {
        await state.pc.setRemoteDescription(new RTCSessionDescription(answer));
        state.hasRemoteDesc = true;
        await drainCandidates(state);
      }
    };

    // Received ICE candidate — queue if no remote desc yet
    const onIceCandidate = async ({
      fromId,
      candidate,
    }: {
      fromId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      const state = peers.current.get(fromId);
      if (!state) return;
      if (state.hasRemoteDesc) {
        try {
          await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {}
      } else {
        state.pendingCandidates.push(candidate);
      }
    };

    // Participant left
    const onParticipantLeft = ({ participantId: id }: { participantId: string }) => {
      const state = peers.current.get(id);
      if (state) {
        state.pc.close();
        peers.current.delete(id);
      }
    };

    socket.on("participant-joined", onParticipantJoined);
    socket.on("offer", onOffer);
    socket.on("answer", onAnswer);
    socket.on("ice-candidate", onIceCandidate);
    socket.on("participant-left", onParticipantLeft);

    return () => {
      socket.off("participant-joined", onParticipantJoined);
      socket.off("offer", onOffer);
      socket.off("answer", onAnswer);
      socket.off("ice-candidate", onIceCandidate);
      socket.off("participant-left", onParticipantLeft);
    };
  }, [socket, participantId, getOrCreatePeer, drainCandidates]);

  // ─── When localStream becomes available, add tracks to existing peers ────
  useEffect(() => {
    if (!localStream) return;
    peers.current.forEach((state) => {
      if (state.pc.getSenders().length === 0) {
        localStream.getTracks().forEach((t) =>
          state.pc.addTrack(t, localStream),
        );
      }
    });
  }, [localStream]);

  // ─── Speaker mute ────────────────────────────────────────────────────────
  const setOutputMuted = useCallback(
    (muted: boolean) => {
      outputMutedRef.current = muted;
      peers.current.forEach((state) => {
        if (state.gainNode?.gain) state.gainNode.gain.value = muted ? 0 : 1;
      });
    },
    [],
  );

  // ─── Cleanup ─────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      peers.current.forEach((state) => state.pc.close());
      peers.current.clear();
    };
  }, []);

  return { setOutputMuted };
}
