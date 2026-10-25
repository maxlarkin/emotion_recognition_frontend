// Pure settings logic: validation against ui.md ranges, dirty check and bulk camera patches.
import { JOURNAL_INTERVALS, type AppSettings, type CameraType, type Stream, type StreamPatch, type StreamSettings } from "../api/types";

export const RANGES = {
  negative_threshold: { min: 0.5, max: 0.9, step: 0.05 },
  positive_threshold: { min: 0.5, max: 0.9, step: 0.05 },
  min_duration_s: { min: 1, max: 30, step: 1 },
  cooldown_s: { min: 10, max: 300, step: 10 },
} as const;

/** Russian error text, or null when the settings are valid. */
export function validateSettings(s: AppSettings): string | null {
  const e = s.events;
  if (e.negative_emotions.length === 0) return "Выберите хотя бы одну негативную эмоцию";
  for (const [k, r] of Object.entries(RANGES) as [keyof typeof RANGES, (typeof RANGES)[keyof typeof RANGES]][]) {
    const v = e[k];
    if (!Number.isFinite(v) || v < r.min - 1e-9 || v > r.max + 1e-9) return "Значение вне допустимого диапазона";
  }
  if (!JOURNAL_INTERVALS.includes(s.journal.interval_s)) return "Недопустимый интервал журнала";
  return null;
}

/** Deep equality for plain settings objects (order-insensitive for the emotion list). */
export function sameSettings(a: AppSettings, b: AppSettings): boolean {
  const norm = (s: AppSettings) => JSON.stringify({ ...s, events: { ...s.events, negative_emotions: [...s.events.negative_emotions].sort() } });
  return norm(a) === norm(b);
}

/** Bulk edit: only fields the user chose (non-null) are sent. */
export type BulkDraft = { [K in keyof StreamSettings]: StreamSettings[K] | null } & { camera_type: CameraType | null };

export const EMPTY_BULK: BulkDraft = { enabled: null, analysis_fps: null, detection_size: null, min_face_px: null, camera_type: null };

export function bulkPatch(draft: BulkDraft): StreamPatch {
  const { camera_type, ...rest } = draft;
  const settings: Partial<StreamSettings> = {};
  for (const [k, v] of Object.entries(rest)) if (v !== null) (settings as Record<string, unknown>)[k] = v;
  const out: StreamPatch = {};
  if (camera_type !== null) out.camera_type = camera_type;
  if (Object.keys(settings).length) out.settings = settings;
  return out;
}

export function canApplyBulk(draft: BulkDraft, selected: number): boolean {
  return selected > 0 && Object.keys(bulkPatch(draft)).length > 0;
}

export function matchesCamera(s: Stream, query: string): boolean {
  const q = query.trim().toLocaleLowerCase("ru");
  return !q || `${s.name} ${s.site} ${s.url}`.toLocaleLowerCase("ru").includes(q);
}
