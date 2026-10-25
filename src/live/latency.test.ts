import { describe, expect, it } from "vitest";
import { LatencyWindow, percentile } from "./latency";

describe("percentile", () => {
  it("uses nearest rank", () => {
    const a = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(a, 50)).toBe(50);
    expect(percentile(a, 95)).toBe(95);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("LatencyWindow", () => {
  it("computes p50/p95 of unsorted samples", () => {
    const w = new LatencyWindow(60_000);
    [300, 100, 200, 500, 400].forEach((v, i) => w.add(1000 + i, v));
    expect(w.stats(2000)).toEqual({ count: 5, p50: 300, p95: 500 });
  });

  it("evicts samples older than 60 s", () => {
    const w = new LatencyWindow(60_000);
    w.add(0, 5000);
    w.add(30_000, 100);
    w.add(59_000, 200);
    expect(w.stats(59_000).count).toBe(3);
    const s = w.stats(60_500); // the sample at t=0 is out
    expect(s).toEqual({ count: 2, p50: 100, p95: 200 });
    expect(w.stats(200_000)).toEqual({ count: 0, p50: null, p95: null });
  });

  it("ignores non-finite values", () => {
    const w = new LatencyWindow();
    w.add(1, Number.NaN);
    expect(w.stats(1).count).toBe(0);
  });
});
