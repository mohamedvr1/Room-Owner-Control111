/**
 * useWebRTC — Production WebRTC mesh.
 *
 * In the multi-room architecture, the initial participant list is passed as a
 * prop (received from SocketContext which already processed "room-joined" before
 * this hook mounts). New joiners are handled via the "participant-joined" event.
 *
 * Remote audio: HTML <audio> elements — most reliable cross-browser approach.
 * Features: Opus FEC+DTX, ICE buffering, ICE restart, STUN+TURN, adaptive bitrate.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useSocket } from "../context/SocketContext";

export type NetworkQuality = "excellent" | "good" | "fair" | "poor" | "unknown";

function rttToQuality(rttMs: number, lossRate: number): NetworkQuality {
  if (rttMs <= 0)                               return "unknown";
  if (rttMs < 80  && lossRate < 0.02)           return "excellent";
  if (rttMs < 180 && lossRate < 0.06)           return "good";
  if (rttMs < 350 && lossRate < 0.12)           return "fair";
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
    p["stereo"] = "0"; p["maxplaybackrate"] = "48000"; p["maxaveragebitrate"] = "32000";
    return `a=fmtp:${pt} ${Object.entries(p).map(([k, v]) => `${k}=${v}`).join(";")}`;
  }).join("\n");
}

const BITRATE_MAP: Record<NetworkQuality, number> = {
  excellent: 32000, good: 24000, fair: 16000, poor: 8000, unknown: 24000,
};

async function setBitrate(pc: RTCPeerConnection, quality: NetworkQuality) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "audio") continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = BITRATE_MAP[quality];
      await sender.setParameters(params);
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
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement | null;
  remoteStream: MediaStream;
  iceBuf: RTCIceCandidateInit[];
  hasRemoteSdp: boolean;
}

export function useWebRTC(
  localStream: MediaStream | null,
  isSpeakerOff: boolean,
  roomParticipants: { id: string }[], // current room participants (from SocketContext)
  selfId: string | null,
): { networkQuality: Map<string, NetworkQuality> } {
  const { socket } = useSocket();

  const peersRef       = useRef<Map<string, Peer>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const speakerOffRef  = useRef(isSpeakerOff);
  const [networkQuality, setNetworkQuality] = useState<Map<string, NetworkQuality>>(new Map());
  const qualityRef     = useRef<Map<string, NetworkQuality>>(new Map());
  const initialCalledRef = useRef(false);

  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
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
    const peer: Peer   = { pc, audioEl: null, remoteStream, iceBuf: [], hasRemoteSdp: false };
    peersRef.current.set(peerId, peer);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socket) socket.emit("rtc-ice", { targetId: peerId, candidate: candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") pc.restartIce(); };

    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? remoteStream;
      if (!remoteStream.getTrackById(track.id)) remoteStream.addTrack(track);

      if (peer.audioEl) {
        if (peer.audioEl.srcObject !== stream) peer.audioEl.srcObject = remoteStream;
        return;
      }
      const el = document.createElement("audio");
      el.setAttribute("autoplay", "true");
      el.setAttribute("playsinline", "true");
      el.muted    = speakerOffRef.current;
      el.srcObject = remoteStream;
      el.style.cssText = "position:absolute;width:0;height:0;pointer-events:none;";
      document.body.appendChild(el);
      peer.audioEl = el;
      el.play().catch(() => {
        const retry = () => el.play().catch(() => {});
        document.addEventListener("click",    retry, { once: true });
        document.addEventListener("touchend", retry, { once: true });
      });
    };

    const stream = localStreamRef.current;
    if (stream) stream.getTracks().forEach(t => pc.addTrack(t, stream));
    return peer;
  }, [socket]);

  // ── Offer ────────────────────────────────────────────────────────────────
  const call = useCallback(async (peerId: string) => {
    if (!socket) return;
    const peer  = createPeer(peerId);
    try {
      const offer = await peer.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      offer.sdp   = applyOpusSdp(offer.sdp ?? "");
      await peer.pc.setLocalDescription(offer);
      socket.emit("rtc-offer", { targetId: peerId, sdp: peer.pc.localDescription });
    } catch (e) { console.error("offer failed", e); }
  }, [socket, createPeer]);

  // ── Initial call: offer all existing participants when hook mounts ────────
  // (SocketContext already processed "room-joined" and set participants before
  //  RoomPage renders, so we can't rely on the socket event here)
  useEffect(() => {
    if (initialCalledRef.current || !socket || !selfId) return;
    const others = roomParticipants.filter(p => p.id !== selfId);
    if (others.length === 0) return;
    initialCalledRef.current = true;
    for (const p of others) {
      if (!peersRef.current.has(p.id)) call(p.id).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, selfId, roomParticipants, call]);

  // ── Socket events ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onParticipantJoined = (p: { id: string }) => {
      if (p.id === selfId) return;
      // Give them 1.5 s to send an offer first; if not, we call them
      setTimeout(() => {
        if (!peersRef.current.has(p.id)) call(p.id).catch(() => {});
      }, 1500);
    };

    const onOffer = async ({ fromId, sdp }: { fromId: string; sdp: RTCSessionDescriptionInit }) => {
      if (peersRef.current.has(fromId)) closePeer(fromId);
      const peer = createPeer(fromId);
      await peer.pc.setRemoteDescription(new RTCSessionDescription({ type: sdp.type, sdp: applyOpusSdp(sdp.sdp ?? "") }));
      peer.hasRemoteSdp = true;
      await drainIce(peer);
      const answer = await peer.pc.createAnswer();
      answer.sdp   = applyOpusSdp(answer.sdp ?? "");
      await peer.pc.setLocalDescription(answer);
      socket.emit("rtc-answer", { targetId: fromId, sdp: peer.pc.localDescription });
    };

    const onAnswer = async ({ fromId, sdp }: { fromId: string; sdp: RTCSessionDescriptionInit }) => {
      const peer = peersRef.current.get(fromId);
      if (!peer || peer.pc.signalingState !== "have-local-offer") return;
      await peer.pc.setRemoteDescription(new RTCSessionDescription({ type: sdp.type, sdp: applyOpusSdp(sdp.sdp ?? "") }));
      peer.hasRemoteSdp = true;
      await drainIce(peer);
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
      socket.off("rtc-offer",  onOffer);
      socket.off("rtc-answer", onAnswer);
      socket.off("rtc-ice",    onIce);
      socket.off("participant-left");
    };
  }, [socket, selfId, call, createPeer, closePeer, drainIce]);

  // ── Add local stream to peers if it arrived late ─────────────────────────
  useEffect(() => {
    if (!localStream) return;
    peersRef.current.forEach(peer => {
      if (peer.pc.getSenders().filter(s => s.track).length === 0)
        localStream.getTracks().forEach(t => peer.pc.addTrack(t, localStream));
    });
  }, [localStream]);

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

  return { networkQuality };
}
