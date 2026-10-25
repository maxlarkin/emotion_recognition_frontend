// Rolling per-stream statistics over the last 30 s of stream_result messages (ui.md Stream detail):
// latency p50/p95 (client render − decode_ts, server clock corrected), usable-face share and median face_px.
import type { StreamFace } from "../api/types";

export const WINDOW_MS = 30_000;

export function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

interface Sample {
  t: number;
  latency: number;
  facePx: number[];
  usable: number;
  faces: number;
}

export interface StatsView {
  p50: number | null;
  p95: number | null;
  usablePct: number | null;
  medianFacePx: number | null;
}

export class RollingStats {
  private samples: Sample[] = [];

  push(t: number, latencyMs: number, faces: readonly Pick<StreamFace, "decision" | "face_px">[]): void {
    this.samples.push({
      t,
      latency: latencyMs,
      facePx: faces.map((f) => f.face_px),
      usable: faces.filter((f) => f.decision !== "abstain").length,
      faces: faces.length,
    });
    const cutoff = t - WINDOW_MS;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop].t < cutoff) drop++;
    if (drop) this.samples.splice(0, drop);
  }

  clear(): void {
    this.samples = [];
  }

  view(): StatsView {
    const lat = this.samples.map((s) => s.latency).sort((a, b) => a - b);
    const px = this.samples.flatMap((s) => s.facePx).sort((a, b) => a - b);
    const faces = this.samples.reduce((n, s) => n + s.faces, 0);
    const usable = this.samples.reduce((n, s) => n + s.usable, 0);
    return {
      p50: quantile(lat, 0.5),
      p95: quantile(lat, 0.95),
      usablePct: faces ? (usable / faces) * 100 : null,
      medianFacePx: quantile(px, 0.5),
    };
  }
}
