// The one client clock of /ws/live: video frames and audio chunks are stamped on it, and the
// worker matches them in this media time (an audio window is used for a frame up to 2 s later).
import { AUDIO_RATE } from "./protocol";

/** Epoch milliseconds: performance.timeOrigin + performance.now(). */
export const nowEpochMs = (): number => performance.timeOrigin + performance.now();

/** Capture time of a chunk's first sample: it ends at arrival, so it started one chunk earlier. */
export function chunkStartTs(arrivalMs: number, samples: number, rate: number = AUDIO_RATE): number {
  return arrivalMs - (samples / rate) * 1000;
}
