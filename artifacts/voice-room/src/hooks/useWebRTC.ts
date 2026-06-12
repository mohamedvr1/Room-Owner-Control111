/**
 * useWebRTC — Production-grade WebRTC mesh with Opus optimisation and
 * real-time network quality monitoring via RTCPeerConnection.getStats().
 *
 * Browser-native audio features (zero config required):
 *   ✔ Opus codec — FEC, DTX, variable bitrate, jitter buffer
 *   ✔ Echo cancellation, noise suppression, AGC (from getUserMedia constraints)
 *   ✔ DTLS-SRTP encryption end-to-end
 *   ✔ ICE restart on network change (WiFi ↔ 4G)
 *   ✔ NACK + RTX retransmission
 *
 * We add:
 *   ✔ Per-peer DynamicsCompressor (volume normalisation)
 *   ✔ Master gain switch (speaker off without destroying connections)
 *   ✔ ICE candidate buffering (no lost candidates before remote SDP)
 *   ✔ Joiner always offers (eliminates signalling glare)
 *   ✔ Network quality via getStats() every 4 s
 *   ✔ Adaptive bitrate via RTCRtpSender.setParameters()
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
    // Optimal voice settings
    p["minptime"]          = "10";   // 10 ms frames = lowest latency
    p["useinbandfec"]      = "1";    // Opus inband FEC for packet loss
    p["usedtx"]            = "1";    // No transmission during silence
    p["stereo"]            = "0";    // Mono voice
    p["maxplaybackrate"]   = "48000";
    p["maxaveragebitrate"] = "32000"; // 32 kbps — clear voice, low data
    return `a=fmtp:${pt} ${Object.entries(p).map(([k,v]) => `${k}=${v}`).join(";")}`;
  }).join("\n");
}

// ── Adaptive bitrate ────────────────────────────────────────────────────────
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
    } catch { /* may fail on Firefox — ignore */ }
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
  gain: GainNode | null;
  iceBuf: RTCIceCandidateInit[];
  hasRemoteSdp: boolean;
  audioEl: HTMLAudioElement | null;
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useWebRTC(
  localStream: MediaStream | null,
  audioCtx: AudioContext | null,
  isSpeakerOff: boolean,
): { networkQuality: Map<string, NetworkQuality> } {
  const { socket, participantId } = useSocket();

  const peersRef       = useRef<Map<string, Peer>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const masterGainRef  = useRef<GainNode | null>(null);
  const speakerOffRef  = useRef(isSpeakerOff);

  const [networkQuality, setNetworkQuality] = useState<Map<string, NetworkQuality>>(new Map());
  const qualityRef = useRef<Map<string, NetworkQuality>>(new Map());

  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { audioCtxRef.current = audioCtx; }, [audioCtx]);
  useEffect(() => {
    speakerOffRef.current = isSpeakerOff;
    if (masterGainRef.current) masterGainRef.current.gain.value = isSpeakerOff ? 0 : 1;
    // Also update audio elements (Safari fallback)
    peersRef.current.forEach(peer => {
      if (peer.audioEl) peer.audioEl.muted = isSpeakerOff;
    });
  }, [isSpeakerOff]);

  // Build master gain on AudioContext ready
  useEffect(() => {
    if (!audioCtx) return;
    const master = audioCtx.createGain();
    master.gain.value = speakerOffRef.current ? 0 : 1;
    master.connect(audioCtx.destination);
    masterGainRef.current = master;
  }, [audioCtx]);

  // ── Remote audio playback chain ──────────────────────────────────────────
  // MediaStreamSource → DynamicsCompressor → per-peer gain → masterGain
  const playRemote = useCallback((peer: Peer, stream: MediaStream) => {
    const ctx    = audioCtxRef.current;
    const master = masterGainRef.current;

    if (ctx && master) {
      try {
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const src  = ctx.createMediaStreamSource(stream);
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -24;
        comp.knee.value      = 12;
        comp.ratio.value     = 6;
        comp.attack.value    = 0.003;
        comp.release.value   = 0.2;
        if (peer.gain) {
          src.connect(comp);
          comp.connect(peer.gain);
          peer.gain.connect(master);
        } else {
          src.connect(comp);
          comp.connect(master);
        }
        return;
      } catch { /* fall to Audio element */ }
    }

    // iOS Safari fallback
    const el = document.createElement("audio");
    el.autoplay = true;
    el.setAttribute("playsinline", "true");
    el.muted    = speakerOffRef.current;
    el.srcObject = stream;
    el.style.display = "none";
    document.body.appendChild(el);
    peer.audioEl = el;
    el.play().catch(() => {});
  }, []);

  // ── Create peer connection ────────────────────────────────────────────────
  const createPeer = useCallback((peerId: string): Peer => {
    const ctx = audioCtxRef.current;
    const pc  = new RTCPeerConnection({
      iceServers:    ICE_SERVERS,
      bundlePolicy:  "max-bundle",
      rtcpMuxPolicy: "require",
    });

    let gain: GainNode | null = null;
    if (ctx) {
      gain = ctx.createGain();
      gain.gain.value = 1;
    }

    const peer: Peer = { pc, gain, iceBuf: [], hasRemoteSdp: false, audioEl: null };
    peersRef.current.set(peerId, peer);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socket) {
        socket.emit("rtc-ice", { targetId: peerId, candidate: candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") pc.restartIce();
    };

    const remoteStream = new MediaStream();
    pc.ontrack = ({ track }) => {
      remoteStream.addTrack(track);
      playRemote(peer, remoteStream);
    };

    // Add local mic
    const stream = localStreamRef.current;
    if (stream) stream.getTracks().forEach(t => pc.addTrack(t, stream));

    return peer;
  }, [socket, playRemote]);

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

  // ── Drain ICE buffer ──────────────────────────────────────────────────────
  const drainIce = useCallback(async (peer: Peer) => {
    for (const c of peer.iceBuf) {
      try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
    }
    peer.iceBuf = [];
  }, []);

  // ── Initiate call to existing peer ────────────────────────────────────────
  const call = useCallback(async (peerId: string) => {
    if (!socket) return;
    const peer = createPeer(peerId);
    try {
      const offer = await peer.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      offer.sdp = applyOpusSdp(offer.sdp ?? "");
      await peer.pc.setLocalDescription(offer);
      socket.emit("rtc-offer", { targetId: peerId, sdp: peer.pc.localDescription });
    } catch (e) { console.error("offer failed", e); }
  }, [socket, createPeer]);

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    // We just joined — offer all existing participants
    const onJoined = (data: { participants: { id: string }[] }) => {
      for (const p of data.participants) {
        if (p.id !== participantId) call(p.id).catch(() => {});
      }
    };

    // Someone else joins after us — wait for their offer, fallback after 1.5 s
    const onParticipantJoined = (p: { id: string }) => {
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
      answer.sdp = applyOpusSdp(answer.sdp ?? "");
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

    socket.on("joined", onJoined);
    socket.on("participant-joined", onParticipantJoined);
    socket.on("rtc-offer",  onOffer);
    socket.on("rtc-answer", onAnswer);
    socket.on("rtc-ice",    onIce);
    socket.on("participant-left", onLeft);

    return () => {
      socket.off("joined", onJoined);
      socket.off("participant-joined", onParticipantJoined);
      socket.off("rtc-offer",  onOffer);
      socket.off("rtc-answer", onAnswer);
      socket.off("rtc-ice",    onIce);
      socket.off("participant-left", onLeft);
    };
  }, [socket, participantId, call, createPeer, closePeer, drainIce]);

  // ── Add local stream to peers that arrived before stream was ready ────────
  useEffect(() => {
    if (!localStream) return;
    peersRef.current.forEach(peer => {
      if (peer.pc.getSenders().filter(s => s.track).length === 0) {
        localStream.getTracks().forEach(t => peer.pc.addTrack(t, localStream));
      }
    });
  }, [localStream]);

  // ── Network quality polling ───────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      let changed = false;
      for (const [peerId, peer] of peersRef.current) {
        if (peer.pc.connectionState === "closed") continue;
        try {
          const stats = await peer.pc.getStats();
          let rttMs    = 0;
          let totalLost = 0;
          let totalSent = 0;

          stats.forEach(r => {
            if (r.type === "remote-inbound-rtp" && r.kind === "audio") {
              rttMs     = (r.roundTripTime ?? 0) * 1000;
              totalLost += r.packetsLost ?? 0;
            }
            if (r.type === "outbound-rtp" && r.kind === "audio") {
              totalSent += r.packetsSent ?? 0;
            }
          });

          const lossRate = totalSent > 0 ? totalLost / totalSent : 0;
          const q = rttToQuality(rttMs, lossRate);

          // Adaptive bitrate based on quality
          if (qualityRef.current.get(peerId) !== q) {
            setBitrate(peer.pc, q).catch(() => {});
          }

          if (qualityRef.current.get(peerId) !== q) {
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

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => { peersRef.current.forEach((_, id) => closePeer(id)); };
  }, [closePeer]);

  return { networkQuality };
}
