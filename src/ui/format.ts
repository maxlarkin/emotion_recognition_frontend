// Russian number/time formatting and label maps shared by all screens (ui.md Design system, Shared states).
import {
  NEGATIVE_EMOTIONS,
  type AudioBlock,
  type CameraType,
  type Decision,
  type Emotion,
  type EmotionEvent,
  type IncidentState,
  type Probs,
  type Stream,
  type StreamState,
} from "../api/types";

/** 4.25, 1 → «4,3»: fixed digits with the Russian decimal comma. */
export const decimal = (v: number, digits: number): string => v.toFixed(digits).replace(".", ",");

/** 0.912 → «0,91» */
export const prob = (p: number): string => (Number.isFinite(p) ? decimal(p, 2) : "—");

/** 4.83 → «4,8 к/с» */
export const fps = (v: number): string => `${decimal(v, 1)} к/с`;

/** 72.4 → «72 %» */
export const percent = (v: number | null | undefined): string => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${Math.round(v)} %`);

const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");

/** Seconds → «м:сс» («1:20»), or «ч:мм:сс» from an hour. */
export function minSec(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return "—";
  const s = Math.floor(totalSec);
  if (s >= 3600) return `${Math.floor(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** Seconds → «мм:сс» (zero-padded minutes, for file positions). */
export function mmss(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return "—";
  const s = Math.floor(totalSec);
  return `${pad(s / 60)}:${pad(s % 60)}`;
}

/** Epoch ms → «чч:мм:сс» in the browser's (or given) time zone. */
export function clock(epochMs: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone }).format(new Date(epochMs));
}

/** Interval journal time «чч:мм:сс–мм:сс». */
export function intervalText(fromMs: number, toMs: number, timeZone?: string): string {
  return `${clock(fromMs, timeZone)}–${clock(toMs, timeZone).slice(3)}`;
}

/** Epoch ms → «08.10, 14:03:07». */
export function dayClock(epochMs: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone }).format(new Date(epochMs));
}

export const mb = (v: number): string => (v >= 1024 ? `${decimal(v / 1024, 1)} ГБ` : `${Math.round(v)} МБ`);

export const EMOTION_LABEL: Record<Emotion, string> = {
  anger: "Злость",
  disgust: "Отвращение",
  fear: "Страх",
  happiness: "Радость",
  sadness: "Грусть",
  surprise: "Удивление",
  neutral: "Нейтрально",
};

/** Lower-case labels for running text: «злость 81%». */
export const EMOTION_WORD = Object.fromEntries(Object.entries(EMOTION_LABEL).map(([e, label]) => [e, label.toLowerCase()])) as Record<Emotion, string>;

/** Probability of the negative group (ui.md Face decision boxes). */
export const negativeProb = (p: Probs): number => NEGATIVE_EMOTIONS.reduce((s, k) => s + p[k], 0);

/** Face box tag: «#12 · 0,91» (negative-group probability), «#12 · ?» when abstained. */
export function boxLabel(f: { track_id: number; fused: Probs; decision?: string }): string {
  return `#${f.track_id} · ${f.decision === "abstain" ? "?" : prob(negativeProb(f.fused))}`;
}

export const DECISION_LABEL: Record<Decision, string> = {
  alert: "Инцидент",
  watch: "Наблюдение",
  abstain: "Не уверена",
  positive: "Позитив",
  none: "Норма",
};

const DECISION_RANK: Record<Decision, number> = { alert: 4, watch: 3, abstain: 2, positive: 1, none: 0 };

/** Worst decision first: alert > watch > abstain > positive > none. Null for no faces. */
export function worstDecision(ds: Iterable<Decision>): Decision | null {
  let worst: Decision | null = null;
  for (const d of ds) if (worst === null || DECISION_RANK[d] > DECISION_RANK[worst]) worst = d;
  return worst;
}

export type StatusGroup = "live" | "connecting" | "offline";

export function statusGroup(s: StreamState): StatusGroup {
  if (s === "running") return "live";
  if (s === "connecting" || s === "reconnecting") return "connecting";
  return "offline";
}

export const STATUS_LABEL: Record<StatusGroup, string> = { live: "В эфире", connecting: "Подключение", offline: "Нет сигнала" };

export const CAMERA_TYPE_LABEL: Record<CameraType, string> = { webcam: "Веб-камера", sector: "Секторная", security: "Купольная" };

/** Detection size of each camera type (camera-profiles.md). */
export const CAMERA_TYPE_DETECTION: Record<CameraType, number> = { webcam: 640, sector: 1920, security: 2560 };

export const INCIDENT_LABEL: Record<IncidentState, string> = { new: "Новое", confirmed: "Подтверждено", false_alarm: "Ложное" };

export const resolution = (r: [number, number] | null): string => (r ? `${r[0]}×${r[1]}` : "—");

export const NO_SITE = "Без точки";

/** Site of a stream for display: an empty site is «Без точки». */
export const siteLabel = (site: string): string => site.trim() || NO_SITE;

/** Voice line of a stream: «нет аудио» without an audio track, «—» before the first window, else the label or «нет речи». */
export function streamVoice(hasAudio: boolean, audio: AudioBlock | null): string {
  if (!hasAudio) return "нет аудио";
  if (!audio) return "—";
  return audio.speech && audio.label ? EMOTION_LABEL[audio.label] : "нет речи";
}

/** File-session events carry media milliseconds (interfaces.md, Emotion event); live ones carry epoch ms. */
export const isMediaTime = (ms: number): boolean => ms < 1e11;

/** Event time: «10.10, 14:03:07» for live sources, «запись 04:06» for a position inside a file. */
export function eventTime(ms: number, timeZone?: string): string {
  return isMediaTime(ms) ? `запись ${mmss(ms / 1000)}` : dayClock(ms, timeZone);
}

/** Source of an event: «Точка · камера», «Веб-камера», or the file name of a file session. */
export function cameraName(
  e: Pick<EmotionEvent, "stream_id" | "emit_ts" | "session_id">,
  streams: readonly Stream[] | null,
  files?: ReadonlyMap<string, string>,
): string {
  if (!e.stream_id) return isMediaTime(e.emit_ts) ? (files?.get(e.session_id) ?? "Запись") : "Веб-камера";
  const s = streams?.find((x) => x.id === e.stream_id);
  return s ? `${siteLabel(s.site)} · ${s.name}` : e.stream_id;
}
