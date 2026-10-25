// Streaming resampler for the microphone: low-pass at the input rate (windowed-sinc FIR, Blackman),
// then decimate to the output rate by linear interpolation between filtered samples. Pure code with
// no Web Audio types, so the AudioWorklet (pcm-worklet.ts) and the unit tests share it.

export const TARGET_RATE = 16000;
const CUTOFF_HZ = 6500; // -6 dB point; the stopband starts below the 8 kHz Nyquist of 16 kHz
const TRANSITION_HZ = 1500;

/** Odd-length, unity-DC-gain low-pass FIR for `rate`, cut off at `cutoffHz`. */
export function lowpassTaps(rate: number, cutoffHz: number, transitionHz: number): Float32Array {
  let n = Math.ceil((5.5 * rate) / transitionHz); // Blackman: transition width ~ 5.5 / N
  if (n % 2 === 0) n += 1;
  const fc = cutoffHz / rate; // cycles per sample
  const mid = (n - 1) / 2;
  const taps = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
    taps[i] = sinc * w;
    sum += taps[i];
  }
  for (let i = 0; i < n; i++) taps[i] /= sum;
  return taps;
}

/** Float [-1, 1] -> PCM16 (clipped). */
export function toInt16(x: Float32Array): Int16Array {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    out[i] = Math.round(v < 0 ? v * 32768 : v * 32767);
  }
  return out;
}

export class Resampler {
  readonly taps: Float32Array;
  private readonly step: number; // input samples per output sample
  private buf: Float32Array; // input history; buf[0] is absolute input index `base`
  private len = 0;
  private base: number;
  private outCount = 0;

  constructor(
    readonly inRate: number,
    readonly outRate: number = TARGET_RATE,
  ) {
    if (!(inRate > 0) || !(outRate > 0)) throw new Error("sample rates must be positive");
    // Scaled for other output rates; a low-rate device (e.g. 8 kHz) keeps its own anti-alias margin.
    const cutoff = Math.min(CUTOFF_HZ * (outRate / TARGET_RATE), 0.4 * inRate);
    this.taps = lowpassTaps(inRate, cutoff, Math.min(TRANSITION_HZ * (outRate / TARGET_RATE), 0.1 * inRate));
    this.step = inRate / outRate;
    // N - 1 zeros of history, so the first output is defined.
    this.buf = new Float32Array(Math.max(4096, this.taps.length * 2));
    this.len = this.taps.length - 1;
    this.base = -(this.taps.length - 1);
  }

  private fir(abs: number): number {
    const { taps, buf } = this;
    const end = abs - this.base; // index of x[abs] in buf
    let acc = 0;
    for (let j = 0; j < taps.length; j++) acc += taps[j] * buf[end - j];
    return acc;
  }

  /** Feeds input samples; returns every output sample that is now fully determined. */
  process(input: Float32Array): Float32Array {
    if (this.len + input.length > this.buf.length) {
      const grown = new Float32Array(Math.max(this.buf.length * 2, this.len + input.length));
      grown.set(this.buf.subarray(0, this.len));
      this.buf = grown;
    }
    this.buf.set(input, this.len);
    this.len += input.length;
    const total = this.base + this.len; // absolute index one past the newest input sample
    const out: number[] = [];
    for (;;) {
      const t = this.outCount * this.step;
      const i = Math.floor(t);
      if (i + 1 >= total) break;
      const frac = t - i;
      const y0 = this.fir(i);
      out.push(frac === 0 ? y0 : y0 + frac * (this.fir(i + 1) - y0));
      this.outCount++;
    }
    // Keep the history the next output needs: x[floor(t) - (N - 1)] onwards.
    const keepFrom = Math.floor(this.outCount * this.step) - (this.taps.length - 1);
    const drop = Math.max(0, Math.min(this.len, keepFrom - this.base));
    if (drop > 0) {
      this.buf.copyWithin(0, drop, this.len);
      this.len -= drop;
      this.base += drop;
    }
    return Float32Array.from(out);
  }
}

/**
 * Collects PCM16 into fixed-size chunks (the worklet's 500 ms = 8000 samples). Each emitted
 * buffer is owned by the caller (it may be transferred); a fresh one is allocated for the next.
 */
export class ChunkAccumulator {
  private chunk: Int16Array;
  private fill = 0;

  constructor(readonly size: number) {
    if (!(size > 0)) throw new Error("chunk size must be positive");
    this.chunk = new Int16Array(size);
  }

  /** Number of samples waiting for the next chunk. */
  get pending(): number {
    return this.fill;
  }

  /** Appends samples; returns the buffers of every chunk completed by them (oldest first). */
  push(pcm: Int16Array): ArrayBuffer[] {
    const out: ArrayBuffer[] = [];
    let k = 0;
    while (k < pcm.length) {
      const take = Math.min(pcm.length - k, this.size - this.fill);
      this.chunk.set(pcm.subarray(k, k + take), this.fill);
      this.fill += take;
      k += take;
      if (this.fill === this.size) {
        out.push(this.chunk.buffer as ArrayBuffer);
        this.chunk = new Int16Array(this.size);
        this.fill = 0;
      }
    }
    return out;
  }
}
