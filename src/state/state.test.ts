import { describe, expect, it } from "vitest";
import { quantile, RollingStats, WINDOW_MS } from "./stats";

describe("RollingStats", () => {
  it("computes latency quantiles, usable share and median face over the window", () => {
    const r = new RollingStats();
    r.push(0, 100, [{ decision: "none", face_px: 40 }, { decision: "abstain", face_px: 20 }]);
    r.push(100, 300, [{ decision: "alert", face_px: 60 }]);
    r.push(200, 200, []);
    const v = r.view();
    expect(v.p50).toBe(200);
    expect(v.p95).toBe(300);
    expect(v.usablePct).toBeCloseTo((2 / 3) * 100);
    expect(v.medianFacePx).toBe(40);
  });

  it("drops samples older than the window", () => {
    const r = new RollingStats();
    r.push(0, 900, [{ decision: "abstain", face_px: 10 }]);
    r.push(WINDOW_MS + 1, 50, [{ decision: "none", face_px: 80 }]);
    const v = r.view();
    expect(v.p95).toBe(50);
    expect(v.usablePct).toBe(100);
    expect(v.medianFacePx).toBe(80);
  });

  it("reports nulls without data", () => {
    expect(new RollingStats().view()).toEqual({ p50: null, p95: null, usablePct: null, medianFacePx: null });
    expect(quantile([], 0.5)).toBeNull();
  });
});
