import { useEffect, useRef, useCallback } from "react";
import { useSocket } from "../context/SocketContext";

export function useWebRTC(localStream: MediaStream | null) {
  const { socket, participants, participantId } = useSocket();
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreams = useRef<Map<string, MediaStream>>(new Map());

  const createPeerConnection = useCallback((targetId: string) => {
    if (peerConnections.current.has(targetId)) return peerConnections.current.get(targetId)!;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit("ice-candidate", { targetId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      if (!remoteStreams.current.has(targetId)) {
        remoteStreams.current.set(targetId, new MediaStream());
      }
      remoteStreams.current.get(targetId)!.addTrack(event.track);
      
      // Auto-play remote tracks
      const audio = new Audio();
      audio.srcObject = remoteStreams.current.get(targetId)!;
      audio.autoplay = true;
      audio.play().catch(e => console.error("Error playing audio", e));
    };

    if (localStream) {
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    peerConnections.current.set(targetId, pc);
    return pc;
  }, [localStream, socket]);

  useEffect(() => {
    if (!socket || !localStream) return;

    const handleParticipantJoined = async (p: any) => {
      if (p.id === participantId) return;
      const pc = createPeerConnection(p.id);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("offer", { targetId: p.id, offer });
    };

    const handleOffer = async ({ senderId, offer }: any) => {
      const pc = createPeerConnection(senderId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { targetId: senderId, answer });
    };

    const handleAnswer = async ({ senderId, answer }: any) => {
      const pc = peerConnections.current.get(senderId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    };

    const handleIceCandidate = async ({ senderId, candidate }: any) => {
      const pc = peerConnections.current.get(senderId);
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    };
    
    const handleParticipantLeft = ({ participantId: id }: any) => {
      const pc = peerConnections.current.get(id);
      if (pc) {
        pc.close();
        peerConnections.current.delete(id);
      }
      remoteStreams.current.delete(id);
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

  // Clean up
  useEffect(() => {
    return () => {
      peerConnections.current.forEach(pc => pc.close());
      peerConnections.current.clear();
      remoteStreams.current.clear();
    };
  }, []);
}
