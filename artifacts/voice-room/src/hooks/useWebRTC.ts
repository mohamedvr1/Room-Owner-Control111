/**
 * useWebRTC — Mesh WebRTC with audio + screen-share support.
 *
 * CRITICAL: initial calls only fire after localStream is non-null (mic ready).
 * This prevents "no audio" bug where offers are sent before mic stream exists.
 *
 * Remote audio: HTML <audio> elements (reliable cross-browser, no AudioContext needed).
 * Screen share: addTransceiver + onnegotiationneeded for renegotiation.
 */
import { useEffect, useRef, useCallback, useState } from "react";
import { useSocket } from "../context/SocketContext";

export type NetworkQuality = "excellent" | "good" | "fair" | "poor" | "unknown";

function rttToQuality(rttMs: number, lossRate: number): NetworkQuality {
  if (rttMs <= 0)                          return "unknown";
  if (rttMs < 80  && lossRate < 0.02)     return "excellent";
  if (rttMs < 180 && lossRate < 0.06)     return "good";
  if (rttMs < 350 && lossRate < 0.12)     return "fair";
  return "poor";
}

function applyOpusSdp(sdp: string): string {
  const lines = sdp.split("\n");
  let pt: string | null = null;
  for (const l of lines) {
    const m = l.match(/a=rtpmap:(\d+) opus\/48000/i);
    if (m) { pt = m[1]; break; }
  }
  if (!pt) return sdp;
  return lines.map(l => {
    if (!l.startsWith(`a=fmtp:${pt} `)) return l;
    const p: Record<string, string> = {};
    l.slice(`a=fmtp:${pt} `.length).split(";").forEach(kv => {
      const [k, v] = kv.trim().split("=");
      if (k) p[k.trim()] = v?.trim() ?? "1";
    });
    p["minptime"] = "10"; p["useinbandfec"] = "1"; p["usedtx"] = "1";
    p["stereo"] = "0"; p["maxplaybackrate"] = "48000"; p["maxaveragebitrate"] = "40000";
    return `a=fmtp:${pt} ${Object.entries(p).map(([k, v]) => `${k}=${v}`).join(";")}`;
  }).join("\n");
}

const BITRATE: Record<NetworkQuality, number> = { excellent: 40000, good: 32000, fair: 20000, poor: 10000, unknown: 32000 };

async function setBitrate(pc: RTCPeerConnection, q: NetworkQuality) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "audio") continue;
    try {
      const p = sender.getParameters();
      if (!p.encodings?.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = BITRATE[q];
      await sender.setParameters(p);
    } catch { /* ignore */ }
  }
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  {
    urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp"],
    username: "openrelayproject", credential: "openrelayproject",
  },
];

interface Peer {
  pc:           RTCPeerConnection;
  audioEl:      HTMLAudioElement | null;
  remoteStream: MediaStream;
  iceBuf:       RTCIceCandidateInit[];
  hasRemoteSdp: boolean;
  makingOffer:  boolean;
}

export function useWebRTC(
  localStream:      MediaStream | null,
  isSpeakerOff:     boolean,
  roomParticipants: { id: string }[],
  selfId:           string | null,
  onRemoteVideo?:   (stream: MediaStream | null, fromId: string) => void,
): {
  networkQuality:   Map<string, NetworkQuality>;
  addScreenTrack:   (track: MediaStreamTrack, stream: MediaStream) => void;
  removeScreenTrack:(track: MediaStreamTrack) => void;
} {
  const { socket } = useSocket();

  const peersRef          = useRef<Map<string, Peer>>(new Map());
  const localStreamRef    = useRef<MediaStream | null>(null);
  const speakerOffRef     = useRef(isSpeakerOff);
  const socketRef         = useRef(socket);
  const initialCalledRef  = useRef(false);
  const [networkQuality, setNetworkQuality] = useState<Map<string, NetworkQuality>>(new Map());
  const qualityRef        = useRef<Map<string, NetworkQuality>>(new Map());

  useEffect(() => { localStreamRef.current   = localStream; }, [localStream]);
  useEffect(() => { socketRef.current        = socket; },     [socket]);
  useEffect(() => {
    speakerOffRef.current = isSpeakerOff;
    peersRef.current.forEach(peer => { if (peer.audioEl) peer.audioEl.muted = isSpeakerOff; });
  }, [isSpeakerOff]);

  // ── Close peer ───────────────────────────────────────────────────────────
  const closePeer = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer) return;
    peer.pc.close();
    if (peer.audioEl) { peer.audioEl.srcObject = null; peer.audioEl.remove(); }
    peersRef.current.delete(peerId);
    qualityRef.current.delete(peerId);
    setNetworkQuality(new Map(qualityRef.current));
  }, []);

  const drainIce = useCallback(async (peer: Peer) => {
    for (const c of peer.iceBuf) {
      try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
    }
    peer.iceBuf = [];
  }, []);

  // ── Create RTCPeerConnection ─────────────────────────────────────────────
  const createPeer = useCallback((peerId: string): Peer => {
    const pc           = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: "max-bundle", rtcpMuxPolicy: "require" });
    const remoteStream = new MediaStream();
    const peer: Peer   = { pc, audioEl: null, remoteStream, iceBuf: [], hasRemoteSdp: false, makingOffer: false };
    peersRef.current.set(peerId, peer);

    // ── ICE ───────────────────────────────────────────────────────────────
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socketRef.current)
        socketRef.current.emit("rtc-ice", { targetId: peerId, candidate: candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") pc.restartIce();
    };

    // ── Renegotiation (for screen share track adds) ───────────────────────
    pc.onnegotiationneeded = async () => {
      if (peer.makingOffer) return;
      peer.makingOffer = true;
      try {
        const offer = await pc.createOffer();
        if (pc.signalingState !== "stable") { peer.makingOffer = false; return; }
        offer.sdp = applyOpusSdp(offer.sdp ?? "");
        await pc.setLocalDescription(offer);
        socketRef.current?.emit("rtc-offer", { targetId: peerId, sdp: pc.localDescription });
      } catch { /* ignore */ }
      peer.makingOffer = false;
    };

    // ── Incoming tracks ───────────────────────────────────────────────────
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? remoteStream;

      if (track.kind === "audio") {
        if (!remoteStream.getTrackById(track.id)) remoteStream.addTrack(track);
        if (peer.audioEl) {
          if (peer.audioEl.srcObject !== remoteStream) peer.audioEl.srcObject = remoteStream;
          return;
        }
        const el       = document.createElement("audio");
        el.autoplay    = true;
        el.muted       = speakerOffRef.current;
        el.srcObject   = remoteStream;
        el.style.cssText = "position:absolute;width:0;height:0;pointer-events:none;";
        document.body.appendChild(el);
        peer.audioEl   = el;
        el.play().catch(() => {
          const retry = () => el.play().catch(() => {});
          document.addEventListener("click",    retry, { once: true });
          document.addEventListener("touchend", retry, { once: true });
        });
      } else if (track.kind === "video") {
        // Screen share incoming
        onRemoteVideo?.(stream, peerId);
        track.onended = () => onRemoteVideo?.(null, peerId);
      }
    };

    // Add local audio tracks
    const localStream = localStreamRef.current;
    if (localStream) {
      localStream.getTracks().forEach(t => {
        try { pc.addTrack(t, localStream); } catch { /* ignore */ }
      });
    }
    return peer;
  }, [onRemoteVideo]);

  // ── Offer ────────────────────────────────────────────────────────────────
  const call = useCallback(async (peerId: string) => {
    if (!socketRef.current || !localStreamRef.current) return;
    const peer  = createPeer(peerId);
    try {
      const offer = await peer.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      offer.sdp   = applyOpusSdp(offer.sdp ?? "");
      await peer.pc.setLocalDescription(offer);
      socketRef.current.emit("rtc-offer", { targetId: peerId, sdp: peer.pc.localDescription });
    } catch (e) { console.error("offer failed", e); }
  }, [createPeer]);

  // ── Initial call: wait until localStream is ready ────────────────────────
  // AUDIO FIX: Only call peers after mic stream is available
  useEffect(() => {
    if (initialCalledRef.current || !socket || !selfId || !localStream) return;
    const others = roomParticipants.filter(p => p.id !== selfId);
    if (others.length === 0) { initialCalledRef.current = true; return; }
    initialCalledRef.current = true;
    // Small delay to ensure everything is set up
    setTimeout(() => {
      for (const p of others) {
        if (!peersRef.current.has(p.id)) call(p.id).catch(() => {});
      }
    }, 200);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, selfId, localStream, roomParticipants, call]);

  // ── Socket events ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onParticipantJoined = (p: { id: string }) => {
      if (p.id === selfId) return;
      // Wait for their offer first; if none after 2s, we call them
      setTimeout(() => {
        if (!peersRef.current.has(p.id) && localStreamRef.current) call(p.id).catch(() => {});
      }, 2000);
    };

    const onOffer = async ({ fromId, sdp }: { fromId: string; sdp: RTCSessionDescriptionInit }) => {
      const existingPeer = peersRef.current.get(fromId);

      // Perfect negotiation: handle renegotiation (e.g., screen share track added)
      if (existingPeer) {
        const { pc } = existingPeer;
        const polite = false; // we are always impolite (answerer)
        const offerCollision = existingPeer.makingOffer || pc.signalingState !== "stable";
        if (!polite && offerCollision) return; // ignore collision

        try {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: sdp.type, sdp: applyOpusSdp(sdp.sdp ?? "") }));
          existingPeer.hasRemoteSdp = true;
          await drainIce(existingPeer);
          const answer = await pc.createAnswer();
          answer.sdp   = applyOpusSdp(answer.sdp ?? "");
          await pc.setLocalDescription(answer);
          socket.emit("rtc-answer", { targetId: fromId, sdp: pc.localDescription });
        } catch { /* ignore */ }
        return;
      }

      // New connection
      const peer = createPeer(fromId);
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription({ type: sdp.type, sdp: applyOpusSdp(sdp.sdp ?? "") }));
        peer.hasRemoteSdp = true;
        await drainIce(peer);
        const answer = await peer.pc.createAnswer();
        answer.sdp   = applyOpusSdp(answer.sdp ?? "");
        await peer.pc.setLocalDescription(answer);
        socket.emit("rtc-answer", { targetId: fromId, sdp: peer.pc.localDescription });
      } catch (e) { console.error("answer failed", e); }
    };

    const onAnswer = async ({ fromId, sdp }: { fromId: string; sdp: RTCSessionDescriptionInit }) => {
      const peer = peersRef.current.get(fromId);
      if (!peer) return;
      if (peer.pc.signalingState !== "have-local-offer") return;
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription({ type: sdp.type, sdp: applyOpusSdp(sdp.sdp ?? "") }));
        peer.hasRemoteSdp = true;
        await drainIce(peer);
      } catch { /* ignore */ }
    };

    const onIce = async ({ fromId, candidate }: { fromId: string; candidate: RTCIceCandidateInit }) => {
      const peer = peersRef.current.get(fromId);
      if (!peer) return;
      if (peer.hasRemoteSdp) {
        try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* ignore */ }
      } else {
        peer.iceBuf.push(candidate);
      }
    };

    socket.on("participant-joined", onParticipantJoined);
    socket.on("rtc-offer",          onOffer);
    socket.on("rtc-answer",         onAnswer);
    socket.on("rtc-ice",            onIce);
    socket.on("participant-left",   ({ participantId: id }: { participantId: string }) => closePeer(id));

    return () => {
      socket.off("participant-joined", onParticipantJoined);
      socket.off("rtc-offer",          onOffer);
      socket.off("rtc-answer",         onAnswer);
      socket.off("rtc-ice",            onIce);
      socket.off("participant-left");
    };
  }, [socket, selfId, call, createPeer, closePeer, drainIce]);

  // ── Late-arriving localStream: add tracks to existing peers ──────────────
  useEffect(() => {
    if (!localStream) return;
    peersRef.current.forEach(peer => {
      const hasTracks = peer.pc.getSenders().filter(s => s.track?.kind === "audio").length > 0;
      if (!hasTracks) {
        localStream.getTracks().forEach(t => {
          try { peer.pc.addTrack(t, localStream); } catch { /* ignore */ }
        });
      }
    });
  }, [localStream]);

  // ── Screen share: add/remove video track across all peers ────────────────
  const addScreenTrack = useCallback((track: MediaStreamTrack, stream: MediaStream) => {
    peersRef.current.forEach(peer => {
      try {
        peer.pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
        // onnegotiationneeded fires automatically → new offer sent
      } catch { /* ignore */ }
    });
  }, []);

  const removeScreenTrack = useCallback((track: MediaStreamTrack) => {
    peersRef.current.forEach(peer => {
      const sender = peer.pc.getSenders().find(s => s.track?.id === track.id);
      if (sender) {
        try { peer.pc.removeTrack(sender); } catch { /* ignore */ }
        // onnegotiationneeded fires → renegotiation happens
      }
    });
  }, []);

  // ── Network quality polling ──────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      let changed = false;
      for (const [peerId, peer] of peersRef.current) {
        if (peer.pc.connectionState === "closed") continue;
        try {
          const stats = await peer.pc.getStats();
          let rttMs = 0, totalLost = 0, totalSent = 0;
          stats.forEach(r => {
            if (r.type === "remote-inbound-rtp" && r.kind === "audio") { rttMs += (r.roundTripTime ?? 0) * 1000; totalLost += r.packetsLost ?? 0; }
            if (r.type === "outbound-rtp"        && r.kind === "audio") { totalSent += r.packetsSent ?? 0; }
          });
          const lossRate = totalSent > 0 ? totalLost / totalSent : 0;
          const q = rttToQuality(rttMs, lossRate);
          if (qualityRef.current.get(peerId) !== q) {
            setBitrate(peer.pc, q).catch(() => {});
            qualityRef.current.set(peerId, q);
            changed = true;
          }
        } catch { /* ignore */ }
      }
      if (changed) setNetworkQuality(new Map(qualityRef.current));
    };
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return () => { peersRef.current.forEach((_, id) => closePeer(id)); };
  }, [closePeer]);

  return { networkQuality, addScreenTrack, removeScreenTrack };
}
