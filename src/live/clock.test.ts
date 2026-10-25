import { describe, expect, it } from "vitest";
import { chunkStartTs, nowEpochMs } from "./clock";

describe("clock", () => {
  it("a 500 ms chunk (8000 samples at 16 kHz) started 500 ms before it arrived", () => {
    expect(chunkStartTs(1727780000623.4, 8000)).toBeCloseTo(1727780000123.4, 6);
    expect(chunkStartTs(1000, 4000)).toBe(750);
    expect(chunkStartTs(1000, 4800, 48000)).toBe(900);
  });

  it("is epoch milliseconds (same clock as the frames)", () => {
    expect(Math.abs(nowEpochMs() - Date.now())).toBeLessThan(1000);
  });
});
