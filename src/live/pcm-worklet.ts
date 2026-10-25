// AudioWorklet: microphone at the device's native rate -> mono -> low-pass + decimate to 16 kHz ->
// PCM16, posted to the main thread in 500 ms chunks (8000 samples, transferred ArrayBuffer).
// The main thread stamps each chunk on arrival (see mic.ts). Muting closes the whole AudioContext,
// so a processor never has to drop buffered audio.
// Bundled by Vite (`?worker&url`), so it ships with the app and needs no network.
import { ChunkAccumulator, Resampler, TARGET_RATE, toInt16 } from "./resample";

// AudioWorkletGlobalScope (not part of the DOM lib).
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const CHUNK_SAMPLES = TARGET_RATE / 2; // 500 ms

class PcmProcessor extends AudioWorkletProcessor {
  private rs = new Resampler(sampleRate, TARGET_RATE);
  private chunks = new ChunkAccumulator(CHUNK_SAMPLES);
  private mono = new Float32Array(128);

  process(inputs: Float32Array[][]): boolean {
    const chans = inputs[0];
    if (!chans || chans.length === 0 || chans[0].length === 0) return true; // no source connected yet
    const n = chans[0].length;
    if (this.mono.length !== n) this.mono = new Float32Array(n);
    const mono = this.mono;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < chans.length; c++) s += chans[c][i];
      mono[i] = s / chans.length;
    }
    for (const buf of this.chunks.push(toInt16(this.rs.process(mono)))) this.port.postMessage(buf, [buf]);
    return true;
  }
}

registerProcessor("pcm16k", PcmProcessor);
