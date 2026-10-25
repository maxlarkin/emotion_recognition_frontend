// One live session outside React: socket, capture loop, overlay, microphone and latency statistics.
import { openLiveSocket, type LiveSocket } from "../api/stub/live";
import { LatencyWindow, type LatencyStats } from "./latency";
import { nowEpochMs } from "./clock";
import { MicCapture } from "./mic";
import { containRect, drawOverlay, isStale } from "./overlay";
import type { MicState } from "./panel";
import { encodeAudio, encodeFrame, parseServerMessage, type FrameResult } from "./protocol";

const FPS = 8;
const MAX_SIDE = 640;
const JPEG_QUALITY = 0.8;
const MAX_BUFFERED_BYTES = 64 * 1024; // skip a capture while the socket still holds unsent data
const STATS_MS = 500;
const RATE_WINDOW_MS = 5000;
const SIZES_MAX = 512; // frame sizes kept while awaiting results
const MAX_AUDIO_BUFFERED_BYTES = 512 * 1024; // the socket is badly backed up: drop audio chunks

export interface Readout extends LatencyStats {
  rate: number; // results per second over the last 5 s
}

export const EMPTY_READOUT: Readout = { count: 0, p50: null, p95: null, rate: 0 };

export interface Callbacks {
  onSession: () => void;
  onFatal: (message: string) => void;
  onNotice: (message: string) => void;
  onStats: (r: Readout) => void;
  onResult: (res: FrameResult | null) => void; // latest result for the panel; null when stale
  onMic: (state: MicState) => void;
}

/** One live session: socket, capture loop, overlay and latency statistics. */
export class LiveRun {
  private ws: LiveSocket;
  private running = false;
  private stopped = false;
  private encoding = false;
  private frameId = 0;
  private sizes = new Map<number, { w: number; h: number }>(); // frame_id -> JPEG size
  private latest: { res: FrameResult; w: number; h: number } | null = null;
  private lastResultAt = 0;
  private hasOverlay = false;
  private lastServerError: string | null = null;
  private latency = new LatencyWindow();
  private resultTimes: number[] = [];
  private captureCanvas = document.createElement("canvas");
  private timers: number[] = [];
  private raf = 0;
  private panelShown = false;
  private mic: MicCapture | null = null;
  private micOpening = false;

  constructor(
    private readonly stream: MediaStream,
    private readonly video: HTMLVideoElement,
    private readonly overlay: HTMLCanvasElement,
    private readonly cb: Callbacks,
    private micWanted: boolean,
  ) {
    for (const track of stream.getVideoTracks()) {
      // Fires when the camera is unplugged or access is revoked (not on our own track.stop()).
      track.addEventListener("ended", () => {
        if (!this.stopped) this.cb.onFatal("Камера отключилась. Подключите её и нажмите «Старт» снова.");
      });
    }
    // Stub socket (STUBS.md) in place of the real WebSocket to /ws/live on the page host.
    this.ws = openLiveSocket();
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => this.ws.send(JSON.stringify({ type: "start" }));
    this.ws.onmessage = (ev) => {
      if (typeof ev.data === "string") this.onMessage(ev.data);
    };
    this.ws.onclose = (ev) => {
      if (this.stopped) return;
      this.cb.onFatal(this.lastServerError ?? `Соединение с сервером закрыто (код ${ev.code}).`);
    };
  }

  private onMessage(text: string): void {
    if (this.stopped) return;
    const msg = parseServerMessage(text);
    if (msg === null) return;
    if (msg.type === "session") {
      this.running = true;
      this.cb.onSession();
      this.timers.push(
        window.setInterval(() => this.capture(), 1000 / FPS),
        window.setInterval(() => this.checkStale(), 200),
        window.setInterval(() => this.publishStats(), STATS_MS),
      );
      this.cb.onMic(this.micWanted ? "starting" : "off");
      if (this.micWanted) void this.openMic();
    } else if (msg.type === "error") {
      this.lastServerError = msg.message;
      if (this.running) this.cb.onNotice(msg.message);
      else this.cb.onFatal(msg.message); // e.g. models still loading: no session
    } else {
      const size = this.sizes.get(msg.frame_id);
      if (!size) return;
      for (const id of this.sizes.keys()) if (id <= msg.frame_id) this.sizes.delete(id);
      if (document.hidden) {
        this.latest = null; // rAF is paused in a hidden tab: its late paint is not a latency sample
        return;
      }
      this.latest = { res: msg, ...size };
      this.panelShown = true;
      this.cb.onResult(msg);
      this.lastResultAt = performance.now();
      this.resultTimes.push(this.lastResultAt);
      if (!this.raf) this.raf = requestAnimationFrame(() => this.render());
    }
  }

  private capture(): void {
    const { ws, video } = this;
    if (document.hidden || ws.readyState !== WebSocket.OPEN || this.encoding || ws.bufferedAmount > MAX_BUFFERED_BYTES) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || vw === 0 || vh === 0) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(vw, vh));
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    const c = this.captureCanvas;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const captureTs = nowEpochMs();
    this.encoding = true;
    c.toBlob(
      (blob) => {
        if (!blob || this.stopped) {
          this.encoding = false;
          return;
        }
        blob.arrayBuffer().then(
          (buf) => {
            this.encoding = false;
            if (this.stopped || this.ws.readyState !== WebSocket.OPEN) return;
            this.frameId = (this.frameId + 1) >>> 0;
            this.sizes.set(this.frameId, { w, h });
            if (this.sizes.size > SIZES_MAX) this.sizes.delete(this.sizes.keys().next().value!);
            this.ws.send(encodeFrame(captureTs, this.frameId, buf));
          },
          () => {
            this.encoding = false;
          },
        );
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  }

  /** Fits the overlay canvas to its CSS box; returns the 2D context in CSS pixels. */
  private overlayContext(): { ctx: CanvasRenderingContext2D; cssW: number; cssH: number } | null {
    const cv = this.overlay;
    const cssW = cv.clientWidth;
    const cssH = cv.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(cssW * dpr);
    const ph = Math.round(cssH * dpr);
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, cssW, cssH };
  }

  private render(): void {
    this.raf = 0;
    const latest = this.latest;
    if (this.stopped || !latest) return;
    this.latest = null;
    const oc = this.overlayContext();
    if (!oc) return;
    const shown = containRect(this.video.videoWidth, this.video.videoHeight, oc.cssW, oc.cssH);
    drawOverlay(oc.ctx, oc.cssW, oc.cssH, latest.res.faces, latest.w, latest.h, shown);
    this.hasOverlay = latest.res.faces.length > 0;
    // Full loop: capture -> encode -> WS -> worker -> WS -> this paint.
    if (document.hidden) return;
    const renderTs = nowEpochMs();
    this.latency.add(renderTs, renderTs - latest.res.capture_ts);
  }

  private clearOverlay(): void {
    const oc = this.overlayContext();
    oc?.ctx.clearRect(0, 0, oc.cssW, oc.cssH);
    this.hasOverlay = false;
  }

  private checkStale(): void {
    if (!isStale(this.lastResultAt, performance.now())) return;
    if (this.hasOverlay) this.clearOverlay();
    if (this.panelShown) {
      this.panelShown = false;
      this.cb.onResult(null);
    }
  }

  // ---- microphone (optional: the session runs video-only without it)

  /** The mic toggle. Off closes the mic (device released, nothing queued is sent); on opens a new one. */
  setMicWanted(on: boolean): void {
    this.micWanted = on;
    if (this.stopped || !this.running) return;
    if (on) {
      void this.openMic(); // no-op while one is open or opening
    } else {
      this.mic?.close();
      this.mic = null;
      if (!this.micOpening) this.cb.onMic("off");
    }
  }

  private async openMic(): Promise<void> {
    if (this.micOpening || this.mic || this.stopped) return;
    this.micOpening = true;
    this.cb.onMic("starting");
    try {
      const mic = await MicCapture.open(
        (pcm, captureTs) => {
          if (this.mic === mic) this.sendAudio(pcm, captureTs); // never from a closed capture
        },
        () => this.onMicEnded(),
      );
      if (this.stopped || !this.micWanted) {
        mic.close(); // stopped or switched off while it was opening
        if (!this.stopped) this.cb.onMic("off");
        return;
      }
      this.mic = mic;
      this.cb.onMic("on");
    } catch {
      // denied, no device, or no AudioWorklet: the session continues with video only
      if (!this.stopped) this.cb.onMic(this.micWanted ? "unavailable" : "off");
    } finally {
      this.micOpening = false;
    }
  }

  private onMicEnded(): void {
    this.mic?.close();
    this.mic = null;
    if (!this.stopped) this.cb.onMic(this.micWanted ? "unavailable" : "off");
  }

  private sendAudio(pcm: Int16Array, captureTs: number): void {
    const { ws } = this;
    if (this.stopped || !this.running || !this.micWanted || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_AUDIO_BUFFERED_BYTES) return;
    ws.send(encodeAudio(captureTs, pcm));
  }

  private publishStats(): void {
    const now = performance.now();
    while (this.resultTimes.length && this.resultTimes[0] < now - RATE_WINDOW_MS) this.resultTimes.shift();
    const elapsed = Math.min(RATE_WINDOW_MS, now - (this.resultTimes[0] ?? now)) || RATE_WINDOW_MS;
    const rate = this.resultTimes.length > 1 ? ((this.resultTimes.length - 1) * 1000) / elapsed : 0;
    this.cb.onStats({ ...this.latency.stats(nowEpochMs()), rate });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.timers.forEach((t) => window.clearInterval(t));
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "stop" }));
      this.ws.close(1000);
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
    this.stream.getTracks().forEach((t) => t.stop());
    this.mic?.close();
    this.mic = null;
    this.clearOverlay();
  }
}
