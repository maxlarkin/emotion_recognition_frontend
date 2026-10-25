// Microphone capture for the live session: getUserMedia (audio only, separate from the camera,
// so a denied mic never blocks video) -> AudioContext at the device's native rate -> AudioWorklet
// (pcm-worklet.ts: mono, low-pass, decimate to 16 kHz, PCM16) -> 500 ms chunks.
import { chunkStartTs, nowEpochMs } from "./clock";
import workletUrl from "./pcm-worklet.ts?worker&url";

export type ChunkHandler = (pcm: Int16Array, captureTs: number) => void;

/** One open microphone. Switching the mic off closes it (device released); on opens a new one. */
export class MicCapture {
  private closed = false;

  private constructor(
    private readonly stream: MediaStream,
    private readonly ctx: AudioContext,
    private readonly node: AudioWorkletNode,
    onChunk: ChunkHandler,
    onEnded: () => void,
  ) {
    node.port.onmessage = (ev: MessageEvent) => {
      if (this.closed || !(ev.data instanceof ArrayBuffer)) return;
      const pcm = new Int16Array(ev.data);
      onChunk(pcm, chunkStartTs(nowEpochMs(), pcm.length)); // same clock as the video frames
    };
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", () => {
        if (!this.closed) onEnded(); // unplugged or access revoked
      });
    }
  }

  /** Throws (DOMException from getUserMedia, or an AudioContext error) if the mic cannot be used. */
  static async open(onChunk: ChunkHandler, onEnded: () => void): Promise<MicCapture> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    let ctx: AudioContext | null = null;
    try {
      // No sampleRate option: Firefox rejects a MediaStream source whose rate differs from the context.
      ctx = new AudioContext();
      await ctx.audioWorklet.addModule(workletUrl);
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "pcm16k", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      src.connect(node);
      node.connect(ctx.destination); // silent output; keeps the node pulled by the graph
      if (ctx.state === "suspended") await ctx.resume();
      return new MicCapture(stream, ctx, node, onChunk, onEnded);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => undefined);
      throw e;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.node.port.onmessage = null;
    this.node.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close().catch(() => undefined);
  }
}
