// Stub analysis engine: simulated face tracks per stream, the event rule from stack.md
// (negative group / happiness >= threshold held for min duration, cooldown per track) and
// per-face decisions.
import { EMOTIONS, type Emotion, type Probs } from "../../live/protocol";
import type { AppSettings, AudioBlock, Decision, EmotionEvent, Stream, StreamFace, StreamResult } from "../types";

/** Deterministic PRNG (mulberry32) so stub scenes are reproducible in tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NEG_ORDER: Emotion[] = ["anger", "sadness", "fear", "disgust"];

/** A 7-key distribution with negative-group mass `neg`, happiness `pos`, the rest neutral/surprise. */
export function makeProbs(neg: number, pos: number, negLead: Emotion): Probs {
  const p = Object.fromEntries(EMOTIONS.map((e) => [e, 0])) as Probs;
  const n = Math.min(1, Math.max(0, neg));
  const h = Math.min(1 - n, Math.max(0, pos));
  const lead = NEG_ORDER.includes(negLead) ? negLead : "anger";
  for (const e of NEG_ORDER) p[e] = e === lead ? n * 0.7 : n * 0.1;
  p.happiness = h;
  const rest = Math.max(0, 1 - n - h);
  p.neutral = rest * 0.85;
  p.surprise = rest * 0.15;
  return p;
}

export function topEmotion(p: Probs): Emotion {
  let best: Emotion = "neutral";
  for (const e of EMOTIONS) if (p[e] > p[best]) best = e;
  return best;
}

export function negativeSum(p: Probs, negatives: readonly Emotion[]): number {
  return negatives.reduce((s, e) => s + p[e], 0);
}

export interface TrackRuleState {
  bornAt: number;
  negSince: number | null;
  posSince: number | null;
  openNegative: string | null; // event id while the negative event is open
  lastNegativeAt: number;
  lastPositiveAt: number;
}

export const newRuleState = (now: number): TrackRuleState => ({
  bornAt: now,
  negSince: null,
  posSince: null,
  openNegative: null,
  lastNegativeAt: -Infinity,
  lastPositiveAt: -Infinity,
});

export interface RuleOutcome {
  decision: Decision;
  emit: "negative" | "positive" | null;
  closeNegative: boolean;
}

/** One step of the per-track rule. Mutates `st` (timers); the caller records emitted events. */
export function applyRule(
  st: TrackRuleState,
  p: Probs,
  facePx: number,
  minFacePx: number,
  now: number,
  cfg: AppSettings["events"],
): RuleOutcome {
  if (facePx < minFacePx || now - st.bornAt < 1000) {
    st.negSince = null;
    st.posSince = null;
    const close = st.openNegative !== null;
    st.openNegative = null;
    return { decision: "abstain", emit: null, closeNegative: close };
  }
  const neg = negativeSum(p, cfg.negative_emotions);
  let emit: RuleOutcome["emit"] = null;
  let closeNegative = false;
  if (neg >= cfg.negative_threshold) {
    st.negSince ??= now;
    const held = now - st.negSince >= cfg.min_duration_s * 1000;
    if (held && st.openNegative === null && now - st.lastNegativeAt >= cfg.cooldown_s * 1000) {
      emit = "negative";
      st.lastNegativeAt = now;
    }
  } else {
    st.negSince = null;
    if (st.openNegative !== null) closeNegative = true;
    st.openNegative = null;
  }
  if (p.happiness >= cfg.positive_threshold) {
    st.posSince ??= now;
    if (now - st.posSince >= cfg.min_duration_s * 1000 && now - st.lastPositiveAt >= cfg.cooldown_s * 1000) {
      emit ??= "positive";
      if (emit === "positive") st.lastPositiveAt = now;
    }
  } else st.posSince = null;

  let decision: Decision;
  if (st.openNegative !== null || emit === "negative") decision = "alert";
  else if (neg >= cfg.negative_threshold) decision = "watch";
  else if (p.happiness >= cfg.positive_threshold) decision = "positive";
  else decision = "none";
  return { decision, emit, closeNegative };
}

interface SimTrack {
  id: number;
  x: number;
  y: number;
  share: number; // face width / frame width
  neg: number;
  pos: number;
  negTarget: number;
  posTarget: number;
  lead: Emotion;
  rule: TrackRuleState;
  negStart: number | null;
  peakNeg: number;
  sumNeg: number;
  samples: number;
}

export interface SimStream {
  stream: Stream;
  tracks: SimTrack[];
  nextTrack: number;
  frameId: number;
  speech: boolean;
  faceShare: number;
  maxTracks: number;
}

export function frameSize(res: [number, number] | null): [number, number] {
  const [w, h] = res ?? [1280, 720];
  const k = 640 / Math.max(w, h);
  return [Math.round(w * k), Math.round(h * k)];
}

export function detectionWidth(s: Stream): number {
  const auto = { webcam: 640, sector: 1920, security: 2560 }[s.camera_type];
  const size = s.settings.detection_size === "auto" ? auto : s.settings.detection_size;
  const [w, h] = s.source_resolution ?? [1280, 720];
  return w >= h ? size : Math.round((size * w) / h);
}

function spawn(sim: SimStream, rnd: () => number, now: number): SimTrack {
  const share = sim.faceShare * (0.8 + rnd() * 0.5);
  return {
    id: sim.nextTrack++,
    x: 0.08 + rnd() * 0.75,
    y: 0.15 + rnd() * 0.4,
    share,
    neg: 0.1 + rnd() * 0.2,
    pos: 0.1,
    negTarget: 0.15,
    posTarget: 0.1,
    lead: NEG_ORDER[Math.floor(rnd() * NEG_ORDER.length)],
    rule: newRuleState(now),
    negStart: null,
    peakNeg: 0,
    sumNeg: 0,
    samples: 0,
  };
}

/** Advances one stream by one analysed frame and returns its result plus any new events. */
export function stepStream(
  sim: SimStream,
  rnd: () => number,
  now: number,
  cfg: AppSettings["events"],
  newEventId: () => string,
): { result: StreamResult; events: EmotionEvent[]; closed: string[] } {
  const s = sim.stream;
  if (sim.frameId === 0) while (sim.tracks.length < sim.maxTracks) sim.tracks.push(spawn(sim, rnd, now - 1500));
  while (sim.tracks.length < sim.maxTracks && rnd() < 0.02) sim.tracks.push(spawn(sim, rnd, now));
  if (sim.tracks.length > 0 && rnd() < 0.002) sim.tracks.shift();
  const [fw, fh] = frameSize(s.source_resolution);
  const detW = detectionWidth(s);
  const events: EmotionEvent[] = [];
  const closed: string[] = [];
  const faces: StreamFace[] = sim.tracks.map((t) => {
    if (rnd() < 0.01) t.negTarget = rnd() < 0.25 ? 0.65 + rnd() * 0.3 : 0.05 + rnd() * 0.3;
    if (rnd() < 0.008) t.posTarget = rnd() < 0.3 ? 0.65 + rnd() * 0.25 : 0.05 + rnd() * 0.2;
    t.neg += (t.negTarget - t.neg) * 0.08 + (rnd() - 0.5) * 0.03;
    t.pos += (t.posTarget - t.pos) * 0.08 + (rnd() - 0.5) * 0.03;
    t.x = Math.min(0.85, Math.max(0.02, t.x + (rnd() - 0.5) * 0.004));
    const probs = makeProbs(t.neg, t.neg > 0.5 ? 0 : t.pos, t.lead);
    const facePx = Math.round(t.share * detW);
    const out = applyRule(t.rule, probs, facePx, s.settings.min_face_px, now, cfg);
    const negNow = negativeSum(probs, cfg.negative_emotions);
    if (out.decision === "watch" || out.decision === "alert") {
      t.negStart ??= now;
      t.peakNeg = Math.max(t.peakNeg, negNow);
      t.sumNeg += negNow;
      t.samples++;
    } else {
      t.negStart = null;
      t.sumNeg = 0;
      t.samples = 0;
    }
    if (out.closeNegative && t.rule.openNegative === null) closed.push(String(t.id));
    if (out.emit) {
      const id = newEventId();
      const start = out.emit === "negative" ? (t.negStart ?? now) : (t.rule.posSince ?? now);
      events.push({
        event_id: id,
        kind: out.emit,
        session_id: s.session_id ?? `rtsp-${s.id}`,
        stream_id: s.id,
        camera_type: s.camera_type,
        track_id: t.id,
        start_ts: start,
        emit_ts: now,
        duration_ms: Math.max(0, now - start),
        emotion: out.emit === "negative" ? t.lead : "happiness",
        group_prob: out.emit === "negative" ? (t.samples ? t.sumNeg / t.samples : negNow) : probs.happiness,
        state: out.emit === "negative" ? "new" : null,
      });
      if (out.emit === "negative") t.rule.openNegative = id;
    }
    const wPx = t.share * fw;
    const face = probs;
    return {
      track_id: t.id,
      box: [Math.round(t.x * fw), Math.round(t.y * fh), Math.round(wPx), Math.round(wPx * 1.25)],
      face,
      face_label: topEmotion(face),
      fused: face,
      fused_label: topEmotion(face),
      confidence: face[topEmotion(face)],
      decision: out.decision,
      face_px: facePx,
    };
  });
  if (rnd() < 0.03) sim.speech = !sim.speech;
  const audio: AudioBlock | null = s.has_audio
    ? sim.speech
      ? { speech: true, probs: { ...makeProbs(0.2, 0.2, "anger"), disgust: 0, fear: 0, surprise: 0 }, label: "neutral", window_end_ts: now }
      : { speech: false, probs: makeProbs(0, 0, "anger"), label: null, window_end_ts: now }
    : null;
  if (audio && !audio.speech) for (const e of EMOTIONS) audio.probs[e] = 0;
  return {
    result: {
      type: "stream_result",
      stream_id: s.id,
      frame_id: ++sim.frameId,
      decode_ts: now - 60 - rnd() * 80,
      emit_ts: now - 10,
      faces,
      audio,
      fps: s.settings.analysis_fps - rnd() * 0.3,
    },
    events,
    closed,
  };
}
