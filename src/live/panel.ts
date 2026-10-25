// Text of the result panel under the video: «Голос», «Лицо», «Итог».
import { EMOTION_WORD } from "../ui/format";
import { faceLabel } from "./overlay";
import type { AudioBlock, FaceResult } from "./protocol";

/** off: switched off by the user; starting: being opened; on: capturing; unavailable: denied or missing. */
export type MicState = "off" | "starting" | "on" | "unavailable";

const pct = (p: number) => `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;

/** «Голос»: mic state first, then the attached audio window (null: no window yet or > 2 s old). */
export function voiceText(mic: MicState, audio: AudioBlock | null): string {
  if (mic === "off") return "микрофон выключен";
  if (mic === "unavailable") return "нет доступа к микрофону";
  if (mic === "starting" || audio === null) return "ожидание…";
  if (!audio.speech || audio.label === null) return "нет речи";
  return `${EMOTION_WORD[audio.label]} ${pct(audio.probs[audio.label])}`;
}

/** The face with the largest box area, or null. */
export function largestFace(faces: readonly FaceResult[]): FaceResult | null {
  let best: FaceResult | null = null;
  for (const f of faces) if (!best || f.box[2] * f.box[3] > best.box[2] * best.box[3]) best = f;
  return best;
}

/** «Лицо»: facial emotion (after smoothing) of the largest face. */
export function faceText(face: FaceResult | null): string {
  if (!face) return "лицо не найдено";
  return `${EMOTION_WORD[face.face_label]} ${pct(face.face[face.face_label])}`;
}

/** «Итог»: fused emotion of the largest face (same text as its overlay label). */
export function fusedText(face: FaceResult | null): string {
  return face ? faceLabel(face) : "лицо не найдено";
}
