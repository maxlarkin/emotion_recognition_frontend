// Sliding-window latency statistics (CAP-1: p50/p95 over the last 60 s).

export const WINDOW_MS = 60_000;

export interface LatencyStats {
  count: number;
  p50: number | null;
  p95: number | null;
}

/** Nearest-rank percentile of an ascending array (p in 0..100). */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export class LatencyWindow {
  private samples: { t: number; v: number }[] = [];

  constructor(private readonly windowMs: number = WINDOW_MS) {}

  /** t: time the sample was taken (ms), v: latency (ms). Samples arrive in time order. */
  add(t: number, v: number): void {
    if (!Number.isFinite(v)) return;
    this.samples.push({ t, v });
    this.evict(t);
  }

  evict(now: number): void {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.samples.length && this.samples[i].t <= cutoff) i++;
    if (i > 0) this.samples.splice(0, i);
  }

  stats(now: number): LatencyStats {
    this.evict(now);
    const sorted = this.samples.map((s) => s.v).sort((a, b) => a - b);
    return { count: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
  }

  clear(): void {
    this.samples = [];
  }
}
