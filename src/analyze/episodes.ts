// Pure helpers for the file result: no-face segments, episodes from events, chart series, nearest frame.
import type { EmotionEvent, Timeline } from "../api/types";

export interface Segment {
  start: number; // ms
  end: number;
}

export interface Episode extends Segment {
  id: string;
  track: number;
  emotion: EmotionEvent["emotion"];
  prob: number;
  kind: EmotionEvent["kind"];
}

/** Runs of frames without faces lasting at least `minMs`. */
export function noFaceSegments(frames: Timeline["frames"], minMs = 1000): Segment[] {
  const out: Segment[] = [];
  let start: number | null = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.faces.length === 0) start ??= f.ts_ms;
    else if (start !== null) {
      if (f.ts_ms - start >= minMs) out.push({ start, end: f.ts_ms });
      start = null;
    }
  }
  if (start !== null && frames.length) {
    const end = frames[frames.length - 1].ts_ms;
    if (end - start >= minMs) out.push({ start, end });
  }
  return out;
}

/** Events of the session as time segments (file timestamps are media milliseconds), oldest first. */
export function toEpisodes(events: readonly EmotionEvent[]): Episode[] {
  return events
    .map((e) => ({ id: e.event_id, start: e.start_ts, end: e.start_ts + e.duration_ms, track: e.track_id, emotion: e.emotion, prob: e.group_prob, kind: e.kind }))
    .sort((a, b) => a.start - b.start);
}

export interface GroupPoint {
  t: number;
  negative: number;
  neutral: number;
  positive: number;
  faces: boolean;
}

/** Mean fused group probabilities per bucket (3 groups, SPEC assumptions). */
export function groupSeries(frames: Timeline["frames"], buckets: number, durationMs: number): GroupPoint[] {
  const n = Math.max(1, buckets);
  const acc = Array.from({ length: n }, () => ({ neg: 0, neu: 0, pos: 0, k: 0 }));
  for (const f of frames) {
    const i = Math.min(n - 1, Math.floor((f.ts_ms / Math.max(1, durationMs)) * n));
    for (const face of f.faces) {
      const p = face.fused;
      acc[i].neg += p.anger + p.disgust + p.fear + p.sadness;
      acc[i].pos += p.happiness;
      acc[i].neu += p.neutral + p.surprise;
      acc[i].k++;
    }
  }
  return acc.map((a, i) => ({
    t: ((i + 0.5) / n) * durationMs,
    negative: a.k ? a.neg / a.k : 0,
    neutral: a.k ? a.neu / a.k : 0,
    positive: a.k ? a.pos / a.k : 0,
    faces: a.k > 0,
  }));
}

/** Last frame at or before `ms` (binary search; frames sorted by ts_ms). */
export function frameAt(frames: Timeline["frames"], ms: number): Timeline["frames"][number] | null {
  let lo = 0;
  let hi = frames.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].ts_ms <= ms) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best < 0 ? null : frames[best];
}

/** Episode containing `ms`, if any. */
export function episodeAt(episodes: readonly Episode[], ms: number): Episode | undefined {
  return episodes.find((e) => ms >= e.start && ms <= e.end);
}
