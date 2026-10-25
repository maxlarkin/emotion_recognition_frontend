// /ws/live wire format (interfaces.md, Live session). All binary fields little-endian.

export const EMOTIONS = ["anger", "disgust", "fear", "happiness", "sadness", "surprise", "neutral"] as const;
export type Emotion = (typeof EMOTIONS)[number];
export type Probs = Record<Emotion, number>;

export const VIDEO_FRAME = 0x01;
export const VIDEO_HEADER_BYTES = 13;
export const AUDIO_CHUNK = 0x02;
export const AUDIO_HEADER_BYTES = 9;
export const AUDIO_RATE = 16000;
/** Server default fusion weights (backend inference/fusion.py W_FACE / W_AUDIO). */
export const DEFAULT_FUSION = { w_face: 0.7, w_audio: 0.3 } as const;

/** 0x01 | f64 capture_ts (ms) | u32 frame_id */
export function encodeFrameHeader(captureTs: number, frameId: number): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(VIDEO_HEADER_BYTES);
  const view = new DataView(buf);
  view.setUint8(0, VIDEO_FRAME);
  view.setFloat64(1, captureTs, true);
  view.setUint32(9, frameId >>> 0, true);
  return new Uint8Array(buf);
}

/** Header + JPEG bytes as one binary message. */
export function encodeFrame(captureTs: number, frameId: number, jpeg: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  const body = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg);
  const out = new Uint8Array(VIDEO_HEADER_BYTES + body.byteLength);
  out.set(encodeFrameHeader(captureTs, frameId), 0);
  out.set(body, VIDEO_HEADER_BYTES);
  return out;
}

/** 0x02 | f64 capture_ts (ms, first sample) | PCM16 LE mono 16 kHz */
export function encodeAudio(captureTs: number, pcm: Int16Array): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(AUDIO_HEADER_BYTES + pcm.length * 2);
  const view = new DataView(buf);
  view.setUint8(0, AUDIO_CHUNK);
  view.setFloat64(1, captureTs, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(AUDIO_HEADER_BYTES + i * 2, pcm[i], true);
  return new Uint8Array(buf);
}

/** Vocal emotion of the window attached to a frame. Silence: speech false, probs all 0, label null. */
export interface AudioBlock {
  speech: boolean;
  probs: Probs;
  label: Emotion | null;
  window_end_ts: number;
}

export interface FaceResult {
  track_id: number;
  box: [number, number, number, number]; // x, y, w, h in pixels of the sent JPEG
  face: Probs;
  face_label: Emotion;
  fused: Probs;
  fused_label: Emotion;
  confidence: number;
}

export interface FrameResult {
  type: "frame_result";
  frame_id: number;
  capture_ts: number;
  proc_ms: number;
  faces: FaceResult[];
  audio: AudioBlock | null; // null: no audio window attached (no mic, muted, or > 2 s old)
}

export type ServerMessage =
  | FrameResult
  | { type: "session"; session_id: string }
  | { type: "error"; message: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isEmotion(v: unknown): v is Emotion {
  return typeof v === "string" && (EMOTIONS as readonly string[]).includes(v);
}

function isProbs(v: unknown): v is Probs {
  return isObj(v) && EMOTIONS.every((k) => typeof v[k] === "number" && Number.isFinite(v[k]));
}

function isFace(v: unknown): v is FaceResult {
  if (!isObj(v)) return false;
  const box = v.box;
  return (
    typeof v.track_id === "number" &&
    Array.isArray(box) &&
    box.length === 4 &&
    box.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    isProbs(v.face) &&
    isEmotion(v.face_label) &&
    isProbs(v.fused) &&
    isEmotion(v.fused_label) &&
    typeof v.confidence === "number"
  );
}

/** The `audio` block of a frame_result; null if absent or malformed (the frame itself is still used). */
export function parseAudio(v: unknown): AudioBlock | null {
  if (!isObj(v) || typeof v.speech !== "boolean" || !isProbs(v.probs)) return null;
  if (typeof v.window_end_ts !== "number" || !Number.isFinite(v.window_end_ts)) return null;
  const raw = v.probs;
  const label = v.label === null || v.label === undefined ? null : isEmotion(v.label) ? v.label : undefined;
  if (label === undefined || (v.speech && label === null)) return null;
  const probs = Object.fromEntries(EMOTIONS.map((k) => [k, raw[k]])) as Probs;
  return {
    speech: v.speech,
    probs,
    label: v.speech ? label : null,
    window_end_ts: v.window_end_ts,
  };
}

/** Parse one text message from the server; null if it is not a known, well-formed message. */
export function parseServerMessage(text: string): ServerMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(obj)) return null;
  switch (obj.type) {
    case "session":
      return typeof obj.session_id === "string" ? { type: "session", session_id: obj.session_id } : null;
    case "error":
      return { type: "error", message: typeof obj.message === "string" ? obj.message : "Неизвестная ошибка" };
    case "frame_result":
      if (
        typeof obj.frame_id !== "number" ||
        typeof obj.capture_ts !== "number" ||
        !Array.isArray(obj.faces) ||
        !obj.faces.every(isFace)
      ) {
        return null;
      }
      return { ...(obj as unknown as FrameResult), audio: parseAudio(obj.audio) };
    default:
      return null;
  }
}
