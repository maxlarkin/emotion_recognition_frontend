// Stub of the /ws/live socket (interfaces.md, Live session). It answers `start` with a session and
// every video frame with a frame_result for one simulated face; audio chunks add the voice block
// (speech when the chunk is loud enough). Results go through the same event rule as the streams.
import {
  AUDIO_CHUNK,
  AUDIO_HEADER_BYTES,
  AUDIO_RATE,
  DEFAULT_FUSION,
  EMOTIONS,
  VIDEO_FRAME,
  VIDEO_HEADER_BYTES,
  type AudioBlock,
  type Emotion,
  type FrameResult,
  type Probs,
} from "../../live/protocol";
import type { StreamFace } from "../types";
import { addEvent, endLiveSession, eventSettings, newEventId, startLiveSession } from "./index";
import { applyRule, makeProbs, negativeSum, newRuleState, rng, topEmotion } from "./sim";

/** The part of WebSocket that LiveRun uses. */
export interface LiveSocket {
  binaryType: BinaryType;
  readonly readyState: number;
  readonly bufferedAmount: number;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  send(data: string | Uint8Array<ArrayBuffer>): void;
  close(code?: number): void;
}

const CONNECT_MS = 100;
const PROC_MS = 40; // simulated server time per frame
const AUDIO_FRESH_MS = 2000; // a voice window older than this is not attached (interfaces.md)
const SPEECH_RMS = 600; // PCM16 RMS above which a chunk counts as speech
const FACE_SHARE = 0.28; // face width / frame width
const NEGATIVES: Emotion[] = ["anger", "sadness", "fear", "disgust"];

/** Width and height from the JPEG SOF marker; null if the bytes are not a baseline/progressive JPEG. */
export function jpegSize(b: Uint8Array): [number, number] | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]];
    }
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return null;
}

function pcmRms(view: DataView): number {
  const n = (view.byteLength - AUDIO_HEADER_BYTES) >> 1;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += view.getInt16(AUDIO_HEADER_BYTES + i * 2, true) ** 2;
  return n ? Math.sqrt(sum / n) : 0;
}

class StubLiveSocket implements LiveSocket {
  binaryType: BinaryType = "blob";
  readyState: number = WebSocket.CONNECTING;
  bufferedAmount = 0;
  onopen: LiveSocket["onopen"] = null;
  onmessage: LiveSocket["onmessage"] = null;
  onclose: LiveSocket["onclose"] = null;

  private sessionId: string | null = null;
  private rnd = rng(Date.now() >>> 0);
  private rule = newRuleState(Date.now());
  private face = { x: 0.5, y: 0.45, neg: 0.15, negTarget: 0.15, pos: 0.2, posTarget: 0.2, lead: "anger" as Emotion, negStart: null as number | null };
  private voice: { at: number; endTs: number; speech: boolean } | null = null;

  constructor() {
    setTimeout(() => {
      if (this.readyState !== WebSocket.CONNECTING) return;
      this.readyState = WebSocket.OPEN;
      this.onopen?.();
    }, CONNECT_MS);
  }

  send(data: string | Uint8Array<ArrayBuffer>): void {
    if (this.readyState !== WebSocket.OPEN) return;
    if (typeof data === "string") return this.onText(data);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const kind = view.getUint8(0);
    if (kind === VIDEO_FRAME && data.byteLength > VIDEO_HEADER_BYTES) this.onFrame(view, data.subarray(VIDEO_HEADER_BYTES));
    else if (kind === AUDIO_CHUNK && data.byteLength > AUDIO_HEADER_BYTES) this.onAudio(view);
  }

  close(code = 1005): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    if (this.sessionId) endLiveSession(this.sessionId);
    setTimeout(() => this.onclose?.({ code }), 0);
  }

  private reply(msg: object, ms: number): void {
    setTimeout(() => {
      if (this.readyState === WebSocket.OPEN) this.onmessage?.({ data: JSON.stringify(msg) });
    }, ms);
  }

  private onText(text: string): void {
    let type: unknown;
    try {
      type = (JSON.parse(text) as { type?: unknown }).type;
    } catch {
      return;
    }
    if (type === "start" && !this.sessionId) {
      this.sessionId = startLiveSession();
      this.reply({ type: "session", session_id: this.sessionId }, 150);
    } else if (type === "stop" && this.sessionId) {
      endLiveSession(this.sessionId);
    }
  }

  private onAudio(view: DataView): void {
    const captureTs = view.getFloat64(1, true);
    const samples = (view.byteLength - AUDIO_HEADER_BYTES) >> 1;
    this.voice = { at: Date.now(), endTs: captureTs + (samples / AUDIO_RATE) * 1000, speech: pcmRms(view) > SPEECH_RMS };
  }

  private onFrame(view: DataView, jpeg: Uint8Array): void {
    if (!this.sessionId) return;
    const captureTs = view.getFloat64(1, true);
    const frameId = view.getUint32(9, true);
    const [w, h] = jpegSize(jpeg) ?? [640, 480];
    const audio = this.audioBlock();
    const result: FrameResult = {
      type: "frame_result",
      frame_id: frameId,
      capture_ts: captureTs,
      proc_ms: PROC_MS + Math.round(this.rnd() * 20),
      faces: [this.step(w, h, captureTs, audio)],
      audio,
    };
    this.reply(result, result.proc_ms);
  }

  private audioBlock(): AudioBlock | null {
    const v = this.voice;
    if (!v || Date.now() - v.at > AUDIO_FRESH_MS) return null;
    if (!v.speech) return { speech: false, probs: Object.fromEntries(EMOTIONS.map((e) => [e, 0])) as Probs, label: null, window_end_ts: v.endTs };
    const probs = { ...makeProbs(this.face.neg * 0.6, this.face.pos * 0.6, this.face.lead), disgust: 0, fear: 0, surprise: 0 };
    return { speech: true, probs, label: topEmotion(probs), window_end_ts: v.endTs };
  }

  /** Advances the simulated face by one frame. */
  private step(w: number, h: number, now: number, audio: AudioBlock | null): StreamFace {
    const f = this.face;
    const r = this.rnd;
    if (r() < 0.01) {
      f.negTarget = r() < 0.3 ? 0.65 + r() * 0.3 : 0.05 + r() * 0.25;
      f.lead = NEGATIVES[Math.floor(r() * NEGATIVES.length)];
    }
    if (r() < 0.01) f.posTarget = r() < 0.3 ? 0.65 + r() * 0.25 : 0.05 + r() * 0.2;
    f.neg = Math.min(1, Math.max(0, f.neg + (f.negTarget - f.neg) * 0.08 + (r() - 0.5) * 0.03));
    f.pos = Math.min(1, Math.max(0, f.pos + (f.posTarget - f.pos) * 0.08 + (r() - 0.5) * 0.03));
    f.x = Math.min(0.75, Math.max(0.25, f.x + (r() - 0.5) * 0.01));
    f.y = Math.min(0.55, Math.max(0.35, f.y + (r() - 0.5) * 0.01));

    const face = makeProbs(f.neg, f.neg > 0.5 ? 0 : f.pos, f.lead);
    const fused = { ...face };
    if (audio?.speech) {
      for (const e of EMOTIONS) fused[e] = DEFAULT_FUSION.w_face * face[e] + DEFAULT_FUSION.w_audio * audio.probs[e];
      const sum = EMOTIONS.reduce((s, e) => s + fused[e], 0);
      for (const e of EMOTIONS) fused[e] /= sum;
    }
    const bw = Math.round(FACE_SHARE * w);
    const bh = Math.round(bw * 1.25);
    const cfg = eventSettings();
    const out = applyRule(this.rule, fused, bw, 48, now, cfg);
    const neg = negativeSum(fused, cfg.negative_emotions);
    if (out.decision === "watch" || out.decision === "alert") f.negStart ??= now;
    else f.negStart = null;
    if (out.emit) {
      const id = newEventId();
      const start = out.emit === "negative" ? (f.negStart ?? now) : (this.rule.posSince ?? now);
      addEvent({
        event_id: id,
        kind: out.emit,
        session_id: this.sessionId!,
        stream_id: null,
        camera_type: null,
        track_id: 1,
        start_ts: start,
        emit_ts: now,
        duration_ms: Math.max(0, now - start),
        emotion: out.emit === "negative" ? f.lead : "happiness",
        group_prob: out.emit === "negative" ? neg : fused.happiness,
        state: out.emit === "negative" ? "new" : null,
      });
      if (out.emit === "negative") this.rule.openNegative = id;
    }
    const label = topEmotion(fused);
    return {
      track_id: 1,
      box: [Math.round(f.x * w - bw / 2), Math.round(f.y * h - bh / 2), bw, bh],
      face,
      face_label: topEmotion(face),
      fused,
      fused_label: label,
      confidence: fused[label],
      decision: out.decision,
      face_px: bw,
    };
  }
}

/** Replaces `new WebSocket(".../ws/live")` in LiveRun. */
export const openLiveSocket = (): LiveSocket => new StubLiveSocket();
