/**
 * useWebRTC — Production WebRTC mesh audio engine.
 *
 * Remote audio: HTML <audio> elements — the most reliable cross-browser approach.
 *   AudioContext-based routing was causing "no sound" on many browsers because
 *   AudioContext requires a user gesture to resume, and the chain can silently
 *   fail at any node. Audio elements auto-play on track arrival.
 *
 * Local audio: whatever MediaStream is passed in (may be gain-processed for owner boost).
 *
 * Features:
 *   ✔ Opus 48kHz FEC + DTX + low-latency framing
 *   ✔ ICE candidate buffering (no lost candidates before remote SDP)
 *   ✔ Joiner-initiates offer (eliminates race conditions / glare)
 *   ✔ ICE restart on connection failure
 *   ✔ STUN + TURN fallback
 *   ✔ Per-peer network quality via getStats() every 4 s
 *   ✔ Adaptive bitrate via setParameters()
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useSocket } from "../context/SocketContext";

// ── Network quality ────────────────────────────────────────────────────────
export type NetworkQuality = "excellent" | "good" | "fair" | "poor" | "unknown";

function rttToQuality(rttMs: number, lossRate: number): NetworkQuality {
  if (rttMs <= 0) return "unknown";
  if (rttMs < 80  && lossRate < 0.02) return "excellent";
  if (rttMs < 180 && lossRate < 0.06) return "good";
  if (rttMs < 350 && lossRate < 0.12) return "fair";
  return "poor";
}

// ── Opus SDP optimisation ──────────────────────────────────────────────────
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
    const rest = l.slice(`a=fmtp:${pt} `.length);
    const p: Record<string, string> = {};
    rest.split(";").forEach(kv => {
      const [k, v] = kv.trim().split("=");
      if (k) p[k.trim()] = v?.trim() ?? "1";
    });
    p["minptime"]          = "10";
    p["useinbandfec"]      = "1";
    p["usedtx"]            = "1";
    p["stereo"]            = "0";
    p["maxplaybackrate"]   = "48000";
    p["maxaveragebitrate"] = "32000";
    return `a=fmtp:${pt} ${Object.entries(p).map(([k,v]) => `${k}=${v}`).join(";")}`;
  }).join("\n");
}

// ── Adaptive bitrate ──────────────────────────────────────────────────────
const BITRATE_MAP: Record<NetworkQuality, number> = {
  excellent: 32000,
  good:      24000,
  fair:      16000,
  poor:       8000,
  unknown:   24000,
};

async function setBitrate(pc: RTCPeerConnection, quality: NetworkQuality) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "audio") continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = BITRATE_MAP[quality];
      await sender.setParameters(params);
    } catch { /* Firefox may reject — ignore */ }
  }
}

// ── ICE servers ────────────────────────────────────────────────────────────
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

// ── Peer state ─────────────────────────────────────────────────────────────
interface Peer {
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement | null;
  remoteStream: MediaStream;
  iceBuf: RTCIceCandidateInit[];
  hasRemoteSdp: boolean;
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useWebRTC(
  localStream: MediaStream | null,
  isSpeakerOff: boolean,
): { networkQuality: Map<string, NetworkQuality> } {
  const { socket, participantId } = useSocket();

  const peersRef       = useRef<Map<string, Peer>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const speakerOffRef  = useRef(isSpeakerOff);

  const [networkQuality, setNetworkQuality] = useState<Map<string, NetworkQuality>>(new Map());
  const qualityRef = useRef<Map<string, NetworkQuality>>(new Map());

  // Sync refs
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);

  useEffect(() => {
    speakerOffRef.current = isSpeakerOff;
    // Mute/unmute all existing audio elements
    peersRef.current.forEach(peer => {
      if (peer.audioEl) peer.audioEl.muted = isSpeakerOff;
    });
  }, [isSpeakerOff]);

  // ── Close peer ─────────────────────────────────────────────────────────
  const closePeer = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer) return;
    peer.pc.close();
    if (peer.audioEl) {
      peer.audioEl.srcObject = null;
      peer.audioEl.remove();
    }
    peersRef.current.delete(peerId);
    qualityRef.current.delete(peerId);
    setNetworkQuality(new Map(qualityRef.current));
  }, []);

  // ── Drain ICE buffer ───────────────────────────────────────────────────
  const drainIce = useCallback(async (peer: Peer) => {
    for (const c of peer.iceBuf) {
      try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
    }
    peer.iceBuf = [];
  }, []);

  // ── Create RTCPeerConnection ───────────────────────────────────────────
  const createPeer = useCallback((peerId: string): Peer => {
    const pc = new RTCPeerConnection({
      iceServers:    ICE_SERVERS,
      bundlePolicy:  "max-bundle",
      rtcpMuxPolicy: "require",
    });

    const remoteStream = new MediaStream();

    const peer: Peer = { pc, audioEl: null, remoteStream, iceBuf: [], hasRemoteSdp: false };
    peersRef.current.set(peerId, peer);

    // ICE candidates → relay to server
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socket) {
        socket.emit("rtc-ice", { targetId: peerId, candidate: candidate.toJSON() });
      }
    };

    // ICE restart on failure
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") pc.restartIce();
    };

    // Remote audio — HTML Audio element: reliable across all browsers
    pc.ontrack = ({ track, streams }) => {
      // Use the stream that came with the track, or our own MediaStream
      const stream = streams[0] ?? remoteStream;

      // Ensure remoteStream has the track
      if (!remoteStream.getTrackById(track.id)) {
        remoteStream.addTrack(track);
      }

      if (peer.audioEl) {
        // Audio element already created; ensure it's pointed at the right stream
        if (peer.audioEl.srcObject !== stream) {
          peer.audioEl.srcObject = remoteStream;
        }
        return;
      }

      // Create audio element
      const el = document.createElement("audio");
      el.setAttribute("autoplay", "true");
      el.setAttribute("playsinline", "true");
      el.muted    = speakerOffRef.current;
      el.srcObject = remoteStream;
      el.style.cssText = "position:absolute;width:0;height:0;pointer-events:none;";
      document.body.appendChild(el);
      peer.audioEl = el;

      // play() — required on some browsers even with autoplay attr
      el.play().catch(() => {
        // If autoplay blocked, retry on next user gesture
        const retry = () => { el.play().catch(() => {}); };
        document.addEventListener("click",    retry, { once: true });
        document.addEventListener("touchend", retry, { once: true });
      });
    };

    // Add local tracks so remote can hear us
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
    }

    return peer;
  }, [socket]);

  // ── Offer (we call, they answer) ─────────────────────────────────────────
  const call = useCallback(async (peerId: string) => {
    if (!socket) return;
    const peer = createPeer(peerId);
    try {
      const offer = await peer.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      offer.sdp   = applyOpusSdp(offer.sdp ?? "");
      await peer.pc.setLocalDescription(offer);
      socket.emit("rtc-offer", { targetId: peerId, sdp: peer.pc.localDescription });
    } catch (e) { console.error("offer failed", e); }
  }, [socket, createPeer]);

  // ── Socket event wiring ───────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onJoined = (data: { participants: { id: string }[] }) => {
      // We just joined — offer every peer who's already in the room
      for (const p of data.participants) {
        if (p.id !== participantId) call(p.id).catch(() => {});
      }
    };

    const onParticipantJoined = (p: { id: string }) => {
      // They joined after us — they will offer us, but fall back if not heard from in 1.5 s
      if (p.id === participantId) return;
      setTimeout(() => {
        if (!peersRef.current.has(p.id)) call(p.id).catch(() => {});
      }, 1500);
    };

    const onOffer = async ({ fromId, sdp }: { fromId: string; sdp: RTCSessionDescriptionInit }) => {
      if (peersRef.current.has(fromId)) closePeer(fromId);
      const peer = createPeer(fromId);
      const desc = new RTCSessionDescription({ type: sdp.type, sdp: applyOpusSdp(sdp.sdp ?? "") });
      await peer.pc.setRemoteDescription(desc);
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
      const desc = new RTCSessionDescription({ type: sdp.type, sdp: applyOpusSdp(sdp.sdp ?? "") });
      await peer.pc.setRemoteDescription(desc);
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

    const onLeft = ({ participantId: id }: { participantId: string }) => closePeer(id);

    socket.on("joined",             onJoined);
    socket.on("participant-joined", onParticipantJoined);
    socket.on("rtc-offer",          onOffer);
    socket.on("rtc-answer",         onAnswer);
    socket.on("rtc-ice",            onIce);
    socket.on("participant-left",   onLeft);

    return () => {
      socket.off("joined",             onJoined);
      socket.off("participant-joined", onParticipantJoined);
      socket.off("rtc-offer",          onOffer);
      socket.off("rtc-answer",         onAnswer);
      socket.off("rtc-ice",            onIce);
      socket.off("participant-left",   onLeft);
    };
  }, [socket, participantId, call, createPeer, closePeer, drainIce]);

  // ── If localStream arrives after peers already created, add tracks ────────
  useEffect(() => {
    if (!localStream) return;
    peersRef.current.forEach(peer => {
      if (peer.pc.getSenders().filter(s => s.track).length === 0) {
        localStream.getTracks().forEach(t => peer.pc.addTrack(t, localStream));
      }
    });
  }, [localStream]);

  // ── Network quality polling ────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      let changed = false;
      for (const [peerId, peer] of peersRef.current) {
        if (peer.pc.connectionState === "closed") continue;
        try {
          const stats = await peer.pc.getStats();
          let rttMs = 0, totalLost = 0, totalSent = 0;
          stats.forEach(r => {
            if (r.type === "remote-inbound-rtp" && r.kind === "audio") {
              rttMs += (r.roundTripTime ?? 0) * 1000;
              totalLost += r.packetsLost ?? 0;
            }
            if (r.type === "outbound-rtp" && r.kind === "audio") {
              totalSent += r.packetsSent ?? 0;
            }
          });
          const lossRate = totalSent > 0 ? totalLost / totalSent : 0;
          const q = rttToQuality(rttMs, lossRate);
          if (qualityRef.current.get(peerId) !== q) {
            setBitrate(peer.pc, q).catch(() => {});
            qualityRef.current.set(peerId, q);
            changed = true;
          }
        } catch { /* PC may be closed */ }
      }
      if (changed) setNetworkQuality(new Map(qualityRef.current));
    };

    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, []);

  // ── Cleanup all peers on unmount ─────────────────────────────────────
  useEffect(() => {
    return () => { peersRef.current.forEach((_, id) => closePeer(id)); };
  }, [closePeer]);

  return { networkQuality };
}
