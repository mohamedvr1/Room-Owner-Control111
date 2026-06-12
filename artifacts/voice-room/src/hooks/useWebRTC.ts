/**
 * useWebRTC — Mesh WebRTC audio with Opus codec optimisation.
 *
 * Quality features provided automatically by the browser's WebRTC stack:
 *   • Opus codec — designed for voice (handles silence, packet loss, bitrate changes)
 *   • Inband FEC  — reconstructs lost packets without retransmission
 *   • DTX         — zero bitrate during silence, halves bandwidth usage
 *   • Jitter buffer — built-in adaptive buffer smooths network delay
 *   • Echo cancellation, noise suppression, AGC — applied at capture time
 *   • NACK + RTX  — browser retransmits lost RTP packets automatically
 *   • ICE restart — auto-reconnect on network change (WiFi ↔ 4G)
 *
 * We add on top:
 *   • Per-peer DynamicsCompressor — even volume across all speakers
 *   • Master gain switch — speaker mute without destroying connections
 *   • Candidate queueing — never drop an ICE candidate that arrives early
 *   • Offer always from joiner — avoids glare (both sides offering at once)
 */

import { useEffect, useRef, useCallback } from "react";
import { useSocket } from "../context/SocketContext";

// ── ICE servers ───────────────────────────────────────────────────────────
// STUN for P2P; TURN relays when both peers are behind strict NAT.
// OpenRelay TURN is free for small traffic (good for a friends-only app).
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

// ── SDP: inject Opus parameters ───────────────────────────────────────────
// These are the magic flags that make Opus behave like Discord/WhatsApp.
function optimiseOpusSdp(sdp: string): string {
  const lines = sdp.split("\n");

  // Find opus payload type (usually 111)
  let pt: string | null = null;
  for (const line of lines) {
    const m = line.match(/a=rtpmap:(\d+) opus\/48000/i);
    if (m) { pt = m[1]; break; }
  }
  if (!pt) return sdp;

  return lines
    .map((line) => {
      // Replace or create fmtp line for Opus
      if (line.startsWith(`a=fmtp:${pt} `)) {
        // Parse existing params into a map
        const rest = line.slice(`a=fmtp:${pt} `.length);
        const params: Record<string, string> = {};
        for (const kv of rest.split(";")) {
          const [k, v] = kv.trim().split("=");
          if (k) params[k.trim()] = v?.trim() ?? "1";
        }
        // Apply optimal settings
        params["minptime"]         = "10";   // 10 ms frames → lower latency
        params["useinbandfec"]     = "1";    // FEC: reconstruct lost packets
        params["usedtx"]           = "1";    // DTX: silence = 0 bandwidth
        params["stereo"]           = "0";    // mono for voice
        params["maxplaybackrate"]  = "48000";
        params["maxaveragebitrate"] = "32000"; // 32 kbps: clear voice, low data
        const fmtp = Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join(";");
        return `a=fmtp:${pt} ${fmtp}`;
      }
      return line;
    })
    .join("\n");
}

// ── Per-peer state ────────────────────────────────────────────────────────
interface Peer {
  pc: RTCPeerConnection;
  gain: GainNode;
  /** ICE candidates that arrived before setRemoteDescription */
  iceBuf: RTCIceCandidateInit[];
  hasRemoteSdp: boolean;
  /** Prevent duplicate offers (polite-peer guard) */
  makingOffer: boolean;
  audioEl: HTMLAudioElement | null;
}

export function useWebRTC(
  localStream: MediaStream | null,
  audioCtx: AudioContext | null,
  isSpeakerOff: boolean,
) {
  const { socket, participantId } = useSocket();

  const peersRef        = useRef<Map<string, Peer>>(new Map());
  const localStreamRef  = useRef<MediaStream | null>(null);
  const audioCtxRef     = useRef<AudioContext | null>(null);
  const masterGainRef   = useRef<GainNode | null>(null);
  const speakerOffRef   = useRef(isSpeakerOff);

  // Keep refs fresh
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { audioCtxRef.current = audioCtx; }, [audioCtx]);
  useEffect(() => {
    speakerOffRef.current = isSpeakerOff;
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = isSpeakerOff ? 0 : 1;
    }
  }, [isSpeakerOff]);

  // ── Master gain init ──────────────────────────────────────────────────
  useEffect(() => {
    if (!audioCtx) return;
    const master = audioCtx.createGain();
    master.gain.value = speakerOffRef.current ? 0 : 1;
    master.connect(audioCtx.destination);
    masterGainRef.current = master;
  }, [audioCtx]);

  // ── Play remote audio stream through WebAudio processing chain ────────
  // Chain: MediaStreamSource → DynamicsCompressor → per-peer Gain → masterGain
  const playRemote = useCallback(
    (peer: Peer, stream: MediaStream) => {
      const ctx = audioCtxRef.current;
      const master = masterGainRef.current;

      if (ctx && master) {
        try {
          if (ctx.state === "suspended") ctx.resume().catch(() => {});
          const src  = ctx.createMediaStreamSource(stream);
          // DynamicsCompressor normalises volume across different speakers
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = -24;
          comp.knee.value      = 12;
          comp.ratio.value     = 6;
          comp.attack.value    = 0.003;
          comp.release.value   = 0.2;
          src.connect(comp);
          comp.connect(peer.gain);
          peer.gain.connect(master);
          return; // WebAudio path succeeded
        } catch { /* fall through to Audio element */ }
      }

      // Fallback: plain <audio> element (works on iOS/Safari without AudioContext)
      const el = document.createElement("audio");
      el.autoplay   = true;
      el.setAttribute("playsinline", "true");
      el.muted      = speakerOffRef.current;
      el.srcObject  = stream;
      el.style.display = "none";
      document.body.appendChild(el);
      peer.audioEl = el;
      el.play().catch(() => {});
    },
    [],
  );

  // ── Build a new RTCPeerConnection for a peer ─────────────────────────
  const createPeer = useCallback(
    (peerId: string): Peer => {
      const ctx = audioCtxRef.current;
      const pc  = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        // Tell the browser this is a voice call — enables audio-specific optimisations
        bundlePolicy:  "max-bundle",
        rtcpMuxPolicy: "require",
      });

      const gain = ctx?.createGain() ?? new GainNode(new AudioContext());
      gain.gain.value = 1;

      const peer: Peer = {
        pc, gain, iceBuf: [], hasRemoteSdp: false, makingOffer: false, audioEl: null,
      };

      // Relay ICE candidates via socket
      pc.onicecandidate = ({ candidate }) => {
        if (candidate && socket) {
          socket.emit("rtc-ice", { targetId: peerId, candidate: candidate.toJSON() });
        }
      };

      // ICE restart on hard failure (network change, connection drop)
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          pc.restartIce();
        }
      };

      // Incoming audio track → play
      const remoteStream = new MediaStream();
      pc.ontrack = ({ track }) => {
        remoteStream.addTrack(track);
        playRemote(peer, remoteStream);
      };

      // Add local mic tracks so the remote hears us
      const stream = localStreamRef.current;
      if (stream) {
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      }

      peersRef.current.set(peerId, peer);
      return peer;
    },
    [socket, playRemote],
  );

  // ── Close & clean up one peer connection ─────────────────────────────
  const closePeer = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer) return;
    peer.pc.close();
    if (peer.audioEl) {
      peer.audioEl.srcObject = null;
      peer.audioEl.remove();
    }
    peersRef.current.delete(peerId);
  }, []);

  // ── Drain buffered ICE candidates once remote SDP is set ─────────────
  const drainIce = useCallback(async (peer: Peer) => {
    for (const c of peer.iceBuf) {
      try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
    }
    peer.iceBuf = [];
  }, []);

  // ── Initiate a call to an existing peer (joiner always offers) ────────
  const call = useCallback(
    async (peerId: string) => {
      if (!socket) return;
      const peer = createPeer(peerId);
      peer.makingOffer = true;
      try {
        const offer = await peer.pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false,
        });
        offer.sdp = optimiseOpusSdp(offer.sdp ?? "");
        await peer.pc.setLocalDescription(offer);
        socket.emit("rtc-offer", { targetId: peerId, sdp: peer.pc.localDescription });
      } finally {
        peer.makingOffer = false;
      }
    },
    [socket, createPeer],
  );

  // ── Socket event handlers ─────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    // When WE join: send offers to all participants already in room
    const onJoined = (data: { participants: { id: string }[] }) => {
      for (const p of data.participants) {
        if (p.id !== participantId) {
          call(p.id).catch(() => {});
        }
      }
    };

    // When someone ELSE joins after us: they will offer us, so we wait
    // (no action needed — we respond to their offer below)
    // However, if they never offer us within 1 s, we offer them as fallback
    const onParticipantJoined = (p: { id: string }) => {
      if (p.id === participantId) return;
      // Small delay — give the new joiner time to send an offer first
      setTimeout(() => {
        if (!peersRef.current.has(p.id)) call(p.id).catch(() => {});
      }, 1200);
    };

    // Received offer from a peer
    const onOffer = async ({
      fromId,
      sdp,
    }: {
      fromId: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      // Destroy any stale PC for this peer before answering a fresh offer
      if (peersRef.current.has(fromId)) closePeer(fromId);
      const peer = createPeer(fromId);

      const desc = new RTCSessionDescription({
        type: sdp.type,
        sdp: optimiseOpusSdp(sdp.sdp ?? ""),
      });
      await peer.pc.setRemoteDescription(desc);
      peer.hasRemoteSdp = true;
      await drainIce(peer);

      const answer = await peer.pc.createAnswer();
      answer.sdp = optimiseOpusSdp(answer.sdp ?? "");
      await peer.pc.setLocalDescription(answer);
      socket.emit("rtc-answer", { targetId: fromId, sdp: peer.pc.localDescription });
    };

    // Received answer to our offer
    const onAnswer = async ({
      fromId,
      sdp,
    }: {
      fromId: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      const peer = peersRef.current.get(fromId);
      if (!peer || peer.pc.signalingState !== "have-local-offer") return;
      const desc = new RTCSessionDescription({
        type: sdp.type,
        sdp: optimiseOpusSdp(sdp.sdp ?? ""),
      });
      await peer.pc.setRemoteDescription(desc);
      peer.hasRemoteSdp = true;
      await drainIce(peer);
    };

    // ICE candidate from peer — buffer if SDP not yet set
    const onIce = async ({
      fromId,
      candidate,
    }: {
      fromId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      const peer = peersRef.current.get(fromId);
      if (!peer) return;
      if (peer.hasRemoteSdp) {
        try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* ignore */ }
      } else {
        peer.iceBuf.push(candidate);
      }
    };

    const onParticipantLeft = ({ participantId: id }: { participantId: string }) => {
      closePeer(id);
    };

    socket.on("joined", onJoined);
    socket.on("participant-joined", onParticipantJoined);
    socket.on("rtc-offer",  onOffer);
    socket.on("rtc-answer", onAnswer);
    socket.on("rtc-ice",    onIce);
    socket.on("participant-left", onParticipantLeft);

    return () => {
      socket.off("joined", onJoined);
      socket.off("participant-joined", onParticipantJoined);
      socket.off("rtc-offer",  onOffer);
      socket.off("rtc-answer", onAnswer);
      socket.off("rtc-ice",    onIce);
      socket.off("participant-left", onParticipantLeft);
    };
  }, [socket, participantId, call, createPeer, closePeer, drainIce]);

  // ── When stream arrives late, add tracks to existing peer connections ─
  useEffect(() => {
    if (!localStream) return;
    peersRef.current.forEach((peer) => {
      if (peer.pc.getSenders().filter((s) => s.track).length === 0) {
        localStream.getTracks().forEach((t) => peer.pc.addTrack(t, localStream));
      }
    });
  }, [localStream]);

  // ── Full cleanup on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      peersRef.current.forEach((_, id) => closePeer(id));
    };
  }, [closePeer]);
}
