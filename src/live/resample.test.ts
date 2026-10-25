import { describe, expect, it } from "vitest";
import { ChunkAccumulator, Resampler, toInt16 } from "./resample";

function tone(freq: number, rate: number, seconds: number, amp = 0.5): Float32Array {
  const n = Math.round(rate * seconds);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return x;
}

/** Feeds `x` in 128-sample render quanta, like an AudioWorklet. */
function run(rs: Resampler, x: Float32Array): Float32Array {
  const parts: number[] = [];
  for (let i = 0; i < x.length; i += 128) parts.push(...rs.process(x.subarray(i, i + 128)));
  return Float32Array.from(parts);
}

/** Amplitude of the `freq` component (single-bin DFT), skipping the filter's start-up. */
function amplitude(y: Float32Array, freq: number, rate: number): number {
  const start = 1600;
  let re = 0;
  let im = 0;
  for (let i = start; i < y.length; i++) {
    re += y[i] * Math.cos((2 * Math.PI * freq * i) / rate);
    im += y[i] * Math.sin((2 * Math.PI * freq * i) / rate);
  }
  return (2 * Math.hypot(re, im)) / (y.length - start);
}

describe("Resampler", () => {
  for (const rate of [48000, 44100, 16000]) {
    it(`${rate} Hz -> 16 kHz: length tracks the rate ratio across render quanta`, () => {
      const rs = new Resampler(rate);
      const y = run(rs, new Float32Array(rate)); // 1 s
      expect(Math.abs(y.length - 16000)).toBeLessThanOrEqual(2);
      const y2 = run(rs, new Float32Array(rate)); // streaming: no drift on the next second
      expect(Math.abs(y.length + y2.length - 32000)).toBeLessThanOrEqual(2);
    });

    it(`${rate} Hz: a 1 kHz tone keeps its amplitude`, () => {
      const y = run(new Resampler(rate), tone(1000, rate, 1));
      expect(amplitude(y, 1000, 16000)).toBeCloseTo(0.5, 2);
    });
  }

  for (const rate of [48000, 44100]) {
    it(`${rate} Hz: a 7 kHz tone is attenuated`, () => {
      const y = run(new Resampler(rate), tone(7000, rate, 1));
      expect(amplitude(y, 7000, 16000)).toBeLessThan(0.5 * 0.1); // at least -20 dB
    });

    it(`${rate} Hz: a 12 kHz tone does not alias into the 16 kHz output`, () => {
      const y = run(new Resampler(rate), tone(12000, rate, 1));
      let peak = 0;
      for (let i = 1600; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]));
      expect(peak).toBeLessThan(0.5 * 0.01);
    });
  }
});

describe("toInt16", () => {
  it("scales and clips", () => {
    expect(Array.from(toInt16(Float32Array.of(0, 1, -1, 2, -2, 0.5)))).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });
});

describe("ChunkAccumulator", () => {
  const quantum = (start: number) => Int16Array.from({ length: 128 }, (_, i) => (start + i) % 32768);

  it("emits exact 8000-sample chunks across 128-sample quanta, in order and without loss", () => {
    const acc = new ChunkAccumulator(8000);
    const chunks: Int16Array[] = [];
    for (let q = 0; q < 200; q++) for (const buf of acc.push(quantum(q * 128))) chunks.push(new Int16Array(buf));
    // 200 * 128 = 25600 samples -> 3 chunks + 1600 pending
    expect(chunks.map((c) => c.length)).toEqual([8000, 8000, 8000]);
    expect(acc.pending).toBe(1600);
    expect(chunks[1][0]).toBe(8000);
    expect(chunks[2][7999]).toBe(23999);
  });

  it("allocates a fresh buffer after each emit (an emitted one may be transferred)", () => {
    const acc = new ChunkAccumulator(4);
    const [a] = acc.push(Int16Array.of(1, 2, 3, 4));
    const [b] = acc.push(Int16Array.of(5, 6, 7, 8));
    expect(a).not.toBe(b);
    expect(Array.from(new Int16Array(a))).toEqual([1, 2, 3, 4]);
    expect(Array.from(new Int16Array(b))).toEqual([5, 6, 7, 8]);
  });

  it("one push can complete several chunks", () => {
    expect(new ChunkAccumulator(3).push(Int16Array.of(1, 2, 3, 4, 5, 6, 7)).length).toBe(2);
  });
});
