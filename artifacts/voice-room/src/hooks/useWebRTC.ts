import { useEffect, useRef, useCallback } from "react";
import { useSocket } from "../context/SocketContext";

export function useWebRTC(localStream: MediaStream | null) {
  const { socket, participantId } = useSocket();
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioElements = useRef<Map<string, HTMLAudioElement>>(new Map());
  const outputMutedRef = useRef(false);

  const playRemoteStream = useCallback((peerId: string, stream: MediaStream) => {
    let audio = audioElements.current.get(peerId);
    if (!audio) {
      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "true");
      document.body.appendChild(audio);
      audioElements.current.set(peerId, audio);
    }
    audio.srcObject = stream;
    audio.play().catch(() => {
      // retry on next user interaction
      const retry = () => { audio!.play().catch(() => {}); document.removeEventListener("click", retry); };
      document.addEventListener("click", retry, { once: true });
    });
  }, []);

  const createPeerConnection = useCallback((peerId: string): RTCPeerConnection => {
    if (peerConnections.current.has(peerId)) {
      return peerConnections.current.get(peerId)!;
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    const remoteStream = new MediaStream();

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit("ice-candidate", { targetId: peerId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => remoteStream.addTrack(track));
      playRemoteStream(peerId, remoteStream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        pc.restartIce();
      }
    };

    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }

    peerConnections.current.set(peerId, pc);
    return pc;
  }, [localStream, socket, playRemoteStream]);

  useEffect(() => {
    if (!socket || !localStream) return;

    const handleParticipantJoined = async (p: { id: string }) => {
      if (p.id === participantId) return;
      const pc = createPeerConnection(p.id);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("offer", { targetId: p.id, offer });
    };

    // Server sends: { fromId, fromName, offer }
    const handleOffer = async ({ fromId, offer }: { fromId: string; offer: RTCSessionDescriptionInit }) => {
      if (fromId === participantId) return;
      const pc = createPeerConnection(fromId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { targetId: fromId, answer });
    };

    // Server sends: { fromId, answer }
    const handleAnswer = async ({ fromId, answer }: { fromId: string; answer: RTCSessionDescriptionInit }) => {
      const pc = peerConnections.current.get(fromId);
      if (pc && pc.signalingState !== "stable") {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    };

    // Server sends: { fromId, candidate }
    const handleIceCandidate = async ({ fromId, candidate }: { fromId: string; candidate: RTCIceCandidateInit }) => {
      const pc = peerConnections.current.get(fromId);
      if (pc) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      }
    };

    const handleParticipantLeft = ({ participantId: id }: { participantId: string }) => {
      const pc = peerConnections.current.get(id);
      if (pc) { pc.close(); peerConnections.current.delete(id); }
      const audio = audioElements.current.get(id);
      if (audio) { audio.remove(); audioElements.current.delete(id); }
    };

    socket.on("participant-joined", handleParticipantJoined);
    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("ice-candidate", handleIceCandidate);
    socket.on("participant-left", handleParticipantLeft);

    return () => {
      socket.off("participant-joined", handleParticipantJoined);
      socket.off("offer", handleOffer);
      socket.off("answer", handleAnswer);
      socket.off("ice-candidate", handleIceCandidate);
      socket.off("participant-left", handleParticipantLeft);
    };
  }, [socket, localStream, participantId, createPeerConnection]);

  const setOutputMuted = useCallback((muted: boolean) => {
    outputMutedRef.current = muted;
    audioElements.current.forEach((a) => { a.muted = muted; });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      peerConnections.current.forEach((pc) => pc.close());
      peerConnections.current.clear();
      audioElements.current.forEach((a) => a.remove());
      audioElements.current.clear();
    };
  }, []);

  return { setOutputMuted };
}
