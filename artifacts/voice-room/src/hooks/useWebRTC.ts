/**
 * useWebRTC — Mesh audio + screen-share.
 *
 * Audio fix: initial calls wait for localStream (mic ready).
 * Screen share fix: manual renegotiation offers (no onnegotiationneeded race).
 */
import { useEffect, useRef, useCallback, useState } from "react";
import { useSocket } from "../context/SocketContext";

export type NetworkQuality = "excellent" | "good" | "fair" | "poor" | "unknown";

function rttToQuality(rttMs: number, lossRate: number): NetworkQuality {
  if (rttMs <= 0)                       return "unknown";
  if (rttMs < 80  && lossRate < 0.02)  return "excellent";
  if (rttMs < 180 && lossRate < 0.06)  return "good";
  if (rttMs < 350 && lossRate < 0.12)  return "fair";
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

const BITRATE: Record<NetworkQuality, number> = {
  excellent: 40000, good: 32000, fair: 20000, poor: 10000, unknown: 32000,
};
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
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject", credential: "openrelayproject",
  },
];

interface Peer {
  pc:           RTCPeerConnection;
  audioEl:      HTMLAudioElement | null;
  remoteStream: MediaStream;
  iceBuf:       RTCIceCandidateInit[];
  hasRemoteSdp: boolean;
  isOfferer:    boolean;   // true = we sent the initial offer (we're the caller)
}

// ── Helper: send a renegotiation offer for a peer ──────────────────────────
async function sendReoffer(
  peer: Peer, peerId: string,
  socket: { emit(ev: string, d: unknown): void },
) {
  if (peer.pc.signalingState !== "stable") return;
  try {
    const offer = await peer.pc.createOffer();
    if (peer.pc.signalingState !== "stable") return;
    offer.sdp = applyOpusSdp(offer.sdp ?? "");
    await peer.pc.setLocalDescription(offer);
    socket.emit("rtc-offer", { targetId: peerId, sdp: peer.pc.localDescription });
  } catch { /* ignore */ }
}

export function useWebRTC(
  localStream:      MediaStream | null,
  isSpeakerOff:     boolean,
  roomParticipants: { id: string }[],
  selfId:           string | null,
  onRemoteVideo?:   (stream: MediaStream | null) => void,
): {
  networkQuality:   Map<string, NetworkQuality>;
  addScreenTrack:   (track: MediaStreamTrack, stream: MediaStream) => Promise<void>;
  removeScreenTrack:(track: MediaStreamTrack) => Promise<void>;
} {
  const { socket } = useSocket();

  const peersRef         = useRef<Map<string, Peer>>(new Map());
  const localStreamRef   = useRef<MediaStream | null>(null);
  const speakerOffRef    = useRef(isSpeakerOff);
  const socketRef        = useRef(socket);
  const onVideoRef       = useRef(onRemoteVideo);
  const initialCalledRef = useRef(false);
  const [networkQuality, setNetworkQuality] = useState<Map<string, NetworkQuality>>(new Map());
  const qualityRef = useRef<Map<string, NetworkQuality>>(new Map());

  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { socketRef.current      = socket; },     [socket]);
  useEffect(() => { onVideoRef.current     = onRemoteVideo; }, [onRemoteVideo]);
  useEffect(() => {
    speakerOffRef.current = isSpeakerOff;
    peersRef.current.forEach(peer => { if (peer.audioEl) peer.audioEl.muted = isSpeakerOff; });
  }, [isSpeakerOff]);

  // ── Close peer ────────────────────────────────────────────────────────────
  const closePeer = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer) return;
    peer.pc.close();
    if (peer.audioEl) { peer.audioEl.srcObject = null; peer.audioEl.remove(); }
    peersRef.current.delete(peerId);
    qualityRef.current.delete(peerId);
    setNetworkQuality(new Map(qualityRef.current));
  }, []);

  const drainIce = async (peer: Peer) => {
    for (const c of peer.iceBuf) {
      try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
    }
    peer.iceBuf = [];
  };

  // ── Create RTCPeerConnection ──────────────────────────────────────────────
  const createPeer = useCallback((peerId: string, isOfferer: boolean): Peer => {
    const pc           = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: "max-bundle", rtcpMuxPolicy: "require" });
    const remoteStream = new MediaStream();
    const peer: Peer   = { pc, audioEl: null, remoteStream, iceBuf: [], hasRemoteSdp: false, isOfferer };
    peersRef.current.set(peerId, peer);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socketRef.current)
        socketRef.current.emit("rtc-ice", { targetId: peerId, candidate: candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") pc.restartIce();
    };

    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? remoteStream;
      if (track.kind === "audio") {
        if (!remoteStream.getTrackById(track.id)) remoteStream.addTrack(track);
        if (peer.audioEl) {
          if (peer.audioEl.srcObject !== remoteStream) peer.audioEl.srcObject = remoteStream;
          return;
        }
        const el = document.createElement("audio");
        el.autoplay  = true;
        el.muted     = speakerOffRef.current;
        el.srcObject = remoteStream;
        el.style.cssText = "position:absolute;width:0;height:0;pointer-events:none;";
        document.body.appendChild(el);
        peer.audioEl = el;
        const tryPlay = () => el.play().catch(() => {});
        tryPlay();
        document.addEventListener("click",    tryPlay, { once: true });
        document.addEventListener("touchend", tryPlay, { once: true });
      } else if (track.kind === "video") {
        onVideoRef.current?.(stream);
        track.onended = () => onVideoRef.current?.(null);
      }
    };

    // Add local audio tracks
    const ls = localStreamRef.current;
    if (ls) ls.getTracks().forEach(t => { try { pc.addTrack(t, ls); } catch { /* ignore */ } });
    return peer;
  }, []);

  // ── Call (initial offer) ──────────────────────────────────────────────────
  const call = useCallback(async (peerId: string) => {
    if (!socketRef.current || !localStreamRef.current) return;
    if (peersRef.current.has(peerId)) return;
    const peer = createPeer(peerId, true);
    try {
      const offer = await peer.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      offer.sdp = applyOpusSdp(offer.sdp ?? "");
      await peer.pc.setLocalDescription(offer);
      socketRef.current.emit("rtc-offer", { targetId: peerId, sdp: peer.pc.localDescription });
    } catch (e) { console.warn("offer failed", e); closePeer(peerId); }
  }, [createPeer, closePeer]);

  // ── Initial call: only after mic ready ────────────────────────────────────
  useEffect(() => {
    if (initialCalledRef.current || !socket || !selfId || !localStream) return;
    const others = roomParticipants.filter(p => p.id !== selfId);
    if (others.length === 0) { initialCalledRef.current = true; return; }
    initialCalledRef.current = true;
    setTimeout(() => {
      for (const p of others) call(p.id).catch(() => {});
    }, 300);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, selfId, localStream, roomParticipants, call]);

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onParticipantJoined = (p: { id: string }) => {
      if (p.id === selfId) return;
      // Wait a bit; if they don't call us, we call them
      setTimeout(() => {
        if (!peersRef.current.has(p.id) && localStreamRef.current)
          call(p.id).catch(() => {});
      }, 2500);
    };

    const onOffer = async ({ fromId, sdp }: { fromId: string; sdp: RTCSessionDescriptionInit }) => {
      const existingPeer = peersRef.current.get(fromId);

      // --- Renegotiation (existing peer, e.g., screen share track added) ---
      if (existingPeer && existingPeer.pc.connectionState !== "closed") {
        const { pc } = existingPeer;
        if (pc.signalingState === "have-local-offer") {
          // We sent an offer and now receive one too — use rollback
          try {
            await pc.setLocalDescription({ type: "rollback" });
          } catch { /* Firefox may not support rollback, close and reconnect */ }
        }
        try {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: sdp.type, sdp: applyOpusSdp(sdp.sdp ?? "") }));
          existingPeer.hasRemoteSdp = true;
          await drainIce(existingPeer);
          const answer = await pc.createAnswer();
          answer.sdp = applyOpusSdp(answer.sdp ?? "");
          await pc.setLocalDescription(answer);
          socket.emit("rtc-answer", { targetId: fromId, sdp: pc.localDescription });
        } catch { /* ignore */ }
        return;
      }

      // --- New connection (they're calling us) ---
      if (existingPeer) closePeer(fromId);
      const peer = createPeer(fromId, false);
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription({ type: sdp.type, sdp: applyOpusSdp(sdp.sdp ?? "") }));
        peer.hasRemoteSdp = true;
        await drainIce(peer);
        const answer = await peer.pc.createAnswer();
        answer.sdp = applyOpusSdp(answer.sdp ?? "");
        await peer.pc.setLocalDescription(answer);
        socket.emit("rtc-answer", { targetId: fromId, sdp: peer.pc.localDescription });
      } catch (e) { console.warn("answer failed", e); closePeer(fromId); }
    };

    const onAnswer = async ({ fromId, sdp }: { fromId: string; sdp: RTCSessionDescriptionInit }) => {
      const peer = peersRef.current.get(fromId);
      if (!peer) return;
      if (!["have-local-offer", "stable"].includes(peer.pc.signalingState)) return;
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
  }, [socket, selfId, call, createPeer, closePeer]);

  // ── Late-arriving localStream: add missing audio tracks ───────────────────
  useEffect(() => {
    if (!localStream) return;
    peersRef.current.forEach(peer => {
      const hasAudio = peer.pc.getSenders().some(s => s.track?.kind === "audio");
      if (!hasAudio)
        localStream.getTracks().forEach(t => { try { peer.pc.addTrack(t, localStream); } catch { /* ignore */ } });
    });
  }, [localStream]);

  // ── Screen share: add video track + renegotiate ───────────────────────────
  const addScreenTrack = useCallback(async (track: MediaStreamTrack, stream: MediaStream) => {
    const sock = socketRef.current;
    if (!sock) return;
    for (const [peerId, peer] of peersRef.current) {
      try {
        peer.pc.addTrack(track, stream);
        await sendReoffer(peer, peerId, sock);
      } catch { /* ignore */ }
    }
  }, []);

  const removeScreenTrack = useCallback(async (track: MediaStreamTrack) => {
    const sock = socketRef.current;
    if (!sock) return;
    for (const [peerId, peer] of peersRef.current) {
      const sender = peer.pc.getSenders().find(s => s.track?.id === track.id);
      if (!sender) continue;
      try {
        peer.pc.removeTrack(sender);
        await sendReoffer(peer, peerId, sock);
      } catch { /* ignore */ }
    }
  }, []);

  // ── Network quality polling ───────────────────────────────────────────────
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
          const q = rttToQuality(rttMs, totalSent > 0 ? totalLost / totalSent : 0);
          if (qualityRef.current.get(peerId) !== q) {
            setBitrate(peer.pc, q).catch(() => {});
            qualityRef.current.set(peerId, q);
            changed = true;
          }
        } catch { /* ignore */ }
      }
      if (changed) setNetworkQuality(new Map(qualityRef.current));
    };
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => () => { peersRef.current.forEach((_, id) => closePeer(id)); }, [closePeer]);

  return { networkQuality, addScreenTrack, removeScreenTrack };
}
