// In-memory stub backend with interfaces.md shapes: every REST call and the /ws/streams socket of
// the app are answered here, nothing goes to the network. State lives for the page session.
// The list of stubs and the real endpoints behind them: STUBS.md in the project root.
import { EMOTIONS, type Emotion } from "../../live/protocol";
import {
  DEFAULT_SETTINGS,
  DEFAULT_STREAM_SETTINGS,
  type AppSettings,
  type EmotionEvent,
  type EventFilters,
  type ExportFormat,
  type FileSession,
  type Health,
  type NewStream,
  type SessionInfo,
  type Stream,
  type StreamFace,
  type StreamLogRow,
  type StreamPatch,
  type StreamTestResult,
  type StreamsMessage,
  type SystemLoad,
  type Timeline,
} from "../types";
import type { UploadProgress } from "../real";
import type { ConnectionEvent, StreamFrame } from "../streamsSocket";
import { DEMO_FILES, DEMO_HEALTH, DEMO_LIVE_SESSIONS, DEMO_STREAMS, demoStream } from "./data";
import { applyRule, frameSize, makeProbs, negativeSum, newRuleState, rng, stepStream, topEmotion, type SimStream } from "./sim";

const LATENCY_MS = 150;
const delay = <T>(value: T, ms = LATENCY_MS): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms));
const fail = (message: string, ms = LATENCY_MS): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const rnd = rng(20261010);
let eventSeq = 0;
const newEventId = () => `ev-${Date.now().toString(36)}-${++eventSeq}`;

const newSim = (stream: Stream, faceShare: number, maxTracks: number): SimStream => ({
  stream,
  tracks: [],
  nextTrack: 1,
  frameId: 0,
  speech: false,
  faceShare,
  maxTracks,
});

const state = {
  sims: DEMO_STREAMS.map((d) => newSim(demoStream(d), d.faceShare, d.tracks)),
  settings: structuredClone(DEFAULT_SETTINGS) as AppSettings,
  events: [] as EmotionEvent[],
  files: [] as FileSession[],
  timelines: new Map<string, Timeline>(),
  media: new Map<string, string>(), // file session id -> object URL of the uploaded file
  live: [] as SessionInfo[],
  rtspStarted: new Map<string, number>(), // rtsp session id -> start (epoch ms)
};

/** Seeds the journal with a few past events and one new incident on cam1. */
function seedEvents(now: number) {
  const mk = (i: number, streamId: string, kind: EmotionEvent["kind"], emotion: Emotion, agoS: number, st: EmotionEvent["state"], track: number) => {
    const sim = state.sims.find((s) => s.stream.id === streamId)!;
    return {
      event_id: `ev-seed-${i}`,
      kind,
      session_id: `rtsp-${streamId}`,
      stream_id: streamId,
      camera_type: sim.stream.camera_type,
      track_id: track,
      start_ts: now - agoS * 1000 - 4200,
      emit_ts: now - agoS * 1000,
      duration_ms: 4200 + i * 900,
      emotion,
      group_prob: kind === "negative" ? 0.72 + (i % 3) * 0.07 : 0.81,
      state: st,
    } satisfies EmotionEvent;
  };
  state.events = [
    mk(1, "cam1", "negative", "anger", 40, "new", 12),
    mk(2, "cam5", "positive", "happiness", 260, null, 4),
    mk(3, "cam4", "negative", "sadness", 900, "confirmed", 2),
    mk(4, "cam2", "negative", "anger", 2400, "false_alarm", 7),
    mk(5, "cam6", "positive", "happiness", 3100, null, 1),
    mk(6, "cam1", "negative", "disgust", 5400, "confirmed", 9),
  ];
}

/** Demo files have no media: they carry `playback_unavailable`, the player shows boxes without video. */
function seedFiles(now: number) {
  state.files = DEMO_FILES.map((f, i) => ({
    id: f.id,
    file_name: f.file_name,
    created_at: now - (i + 1) * 3600_000,
    status: f.status,
    progress: f.status === "done" ? 1 : f.status === "processing" ? 0.42 : null,
    duration_ms: f.duration_s ? f.duration_s * 1000 : null,
    resolution: f.resolution,
    notes: f.status === "failed" ? [] : [...(f.notes ?? []), "playback_unavailable"],
    error: f.error ?? null,
    usable_pct: f.status === "done" ? 61 + i * 3 : null,
  }));
  for (const f of state.files) if (f.status === "done") buildFileResult(f, "confirmed");
}

function seedSessions(now: number) {
  state.live = DEMO_LIVE_SESSIONS.map((s) => ({
    id: s.id,
    kind: "live",
    stream_id: null,
    created_at: now - s.ago_s * 1000,
    duration: s.duration_s,
    status: "finished",
  }));
  state.sims.forEach((sim, i) => {
    if (sim.stream.session_id) state.rtspStarted.set(sim.stream.session_id, now - (i + 1) * 2 * 3600_000);
  });
}

/** Generates a file timeline (5 fps) and its events with the same rule as live streams.
 * `seededState`: files analysed before this page session are shown as already reviewed, so the bell
 * starts with the one seeded live incident instead of every old file incident. */
function buildFileResult(f: FileSession, seededState: "new" | "confirmed" = "new") {
  const r = rng(f.id.length * 7919 + f.file_name.length);
  const dur = f.duration_ms ?? 60_000;
  const [w, h] = frameSize(f.resolution);
  const frames: Timeline["frames"] = [];
  const tracks = new Map<number, { x: number; neg: number; target: number; rule: ReturnType<typeof newRuleState>; lead: Emotion; negStart: number | null; sum: number; n: number }>();
  let nextId = 1;
  let gapUntil = 0;
  const cfg = state.settings.events;
  for (let t = 0; t < dur; t += 200) {
    if (t >= gapUntil && r() < 0.0015) gapUntil = t + 8000 + r() * 15000;
    if (t < gapUntil) {
      tracks.clear();
      frames.push({ ts_ms: t, width: w, height: h, faces: [] });
      continue;
    }
    if (tracks.size < 2 && r() < 0.01) {
      tracks.set(nextId++, { x: 0.1 + r() * 0.6, neg: 0.15, target: 0.15, rule: newRuleState(t), lead: (["anger", "sadness", "fear", "disgust"] as Emotion[])[Math.floor(r() * 4)], negStart: null, sum: 0, n: 0 });
    }
    const faces: StreamFace[] = [];
    for (const [id, tr] of tracks) {
      if (r() < 0.006) tr.target = r() < 0.4 ? 0.7 + r() * 0.25 : 0.1 + r() * 0.2;
      tr.neg += (tr.target - tr.neg) * 0.1 + (r() - 0.5) * 0.03;
      const probs = makeProbs(tr.neg, tr.neg < 0.3 && r() < 0.5 ? 0.62 : 0.1, tr.lead);
      const out = applyRule(tr.rule, probs, 90, 48, t, cfg);
      const neg = negativeSum(probs, cfg.negative_emotions);
      if (out.decision === "watch" || out.decision === "alert") {
        tr.negStart ??= t;
        tr.sum += neg;
        tr.n++;
      } else {
        tr.negStart = null;
        tr.sum = 0;
        tr.n = 0;
      }
      if (out.emit) {
        const ev: EmotionEvent = {
          event_id: newEventId(),
          kind: out.emit,
          session_id: f.id,
          stream_id: null,
          camera_type: null,
          track_id: id,
          start_ts: out.emit === "negative" ? (tr.negStart ?? t) : (tr.rule.posSince ?? t),
          emit_ts: t,
          duration_ms: 2000 + Math.round(r() * 6000),
          emotion: out.emit === "negative" ? tr.lead : "happiness",
          group_prob: out.emit === "negative" ? tr.sum / Math.max(1, tr.n) : probs.happiness,
          state: out.emit === "negative" ? seededState : null,
        };
        state.events.push(ev);
        if (out.emit === "negative") tr.rule.openNegative = ev.event_id;
      }
      const bw = 0.12 * w;
      faces.push({
        track_id: id,
        box: [Math.round(tr.x * w), Math.round(0.25 * h), Math.round(bw), Math.round(bw * 1.25)],
        face: probs,
        face_label: topEmotion(probs),
        fused: probs,
        fused_label: topEmotion(probs),
        confidence: probs[topEmotion(probs)],
        decision: out.decision,
        face_px: 90,
      });
    }
    frames.push({ ts_ms: t, width: w, height: h, faces });
  }
  const noAudio = f.notes.includes("no_audio_track");
  const audio: Timeline["audio"] = [];
  if (!noAudio) {
    for (let t = 3000; t < dur; t += 1000) {
      const speech = Math.sin(t / 9000) > 0;
      const probs = speech ? { ...makeProbs(0.2, 0.25, "anger"), disgust: 0, fear: 0, surprise: 0 } : makeProbs(0, 0, "anger");
      if (!speech) for (const e of EMOTIONS) probs[e] = 0;
      audio.push({ speech, probs, label: speech ? "neutral" : null, window_end_ts: t });
    }
  }
  state.timelines.set(f.id, { session_id: f.id, kind: "file", duration_ms: dur, frames, audio });
}

let started = false;
let filesTimer: ReturnType<typeof setInterval> | undefined;
function ensureStarted() {
  if (started) return;
  started = true;
  const now = Date.now();
  seedEvents(now);
  seedFiles(now);
  seedSessions(now);
  filesTimer = setInterval(tickFiles, 1000);
}

/** A download link that needs no server and no revoke (`<a href>` of the sessions list). */
const dataUrl = (text: string, format: ExportFormat): string =>
  `data:${format === "json" ? "application/json" : "text/csv"};charset=utf-8,${encodeURIComponent(text)}`;

function table(columns: readonly string[], rows: readonly Record<string, unknown>[], format: ExportFormat): string {
  if (format === "json") return JSON.stringify(rows, null, 2);
  return [columns.join(","), ...rows.map((r) => columns.map((c) => r[c] ?? "").join(","))].join("\n");
}

// --- Health and sessions ---

export async function fetchHealth(_signal?: AbortSignal): Promise<Health> {
  return delay(DEMO_HEALTH, 50);
}

function sessionList(now: number): SessionInfo[] {
  const live = state.live.map((s) => (s.status === "running" ? { ...s, duration: (now - s.created_at) / 1000 } : s));
  const rtsp = state.sims.flatMap((sim): SessionInfo[] => {
    const id = sim.stream.session_id;
    const startedAt = id ? state.rtspStarted.get(id) : undefined;
    if (!id || startedAt === undefined) return [];
    const running = sim.stream.state === "running";
    return [{ id, kind: "rtsp", stream_id: sim.stream.id, created_at: startedAt, duration: (now - startedAt) / 1000, status: running ? "running" : "finished" }];
  });
  const files = state.files.map((f): SessionInfo => ({
    id: f.id,
    kind: "file",
    stream_id: null,
    created_at: f.created_at,
    duration: (f.duration_ms ?? 0) / 1000,
    status: f.status,
    file_name: f.file_name,
    progress: f.progress,
  }));
  return [...live, ...rtsp, ...files].sort((a, b) => b.created_at - a.created_at);
}

export async function fetchSessions(_signal?: AbortSignal): Promise<SessionInfo[]> {
  ensureStarted();
  return delay(sessionList(Date.now()));
}

export async function deleteSession(id: string): Promise<void> {
  ensureStarted();
  const s = sessionList(Date.now()).find((x) => x.id === id);
  if (!s) return fail("Сессия не найдена");
  if (["running", "queued", "processing"].includes(s.status)) return fail("Сессия ещё идёт");
  state.live = state.live.filter((x) => x.id !== id);
  state.files = state.files.filter((x) => x.id !== id);
  state.timelines.delete(id);
  state.events = state.events.filter((e) => e.session_id !== id);
  const media = state.media.get(id);
  if (media) URL.revokeObjectURL(media);
  state.media.delete(id);
  state.rtspStarted.delete(id);
  return delay(undefined);
}

const SESSION_COLUMNS = ["session_id", "stream_id", "ts_ms", "source", "track_id", "box_x", "box_y", "box_w", "box_h", ...EMOTIONS.map((e) => `p_${e}`), "face_label", "audio_label", "fused_label", "speech"] as const;

/** Export rows (interfaces.md Export row) from the session timeline; sessions without one export only the header. */
export function exportUrl(id: string, format: ExportFormat): string {
  ensureStarted();
  const t = state.timelines.get(id);
  const probs = (p: Record<Emotion, number>) => Object.fromEntries(EMOTIONS.map((e) => [`p_${e}`, p[e]]));
  const faceRows = (t?.frames ?? []).flatMap((fr) =>
    fr.faces.map((f) => ({
      session_id: id,
      stream_id: null,
      ts_ms: fr.ts_ms,
      source: "face",
      track_id: f.track_id,
      box_x: f.box[0],
      box_y: f.box[1],
      box_w: f.box[2],
      box_h: f.box[3],
      ...probs(f.face),
      face_label: f.face_label,
      audio_label: null,
      fused_label: f.fused_label,
      speech: null,
    })),
  );
  const audioRows = (t?.audio ?? []).map((a) => ({
    session_id: id,
    stream_id: null,
    ts_ms: a.window_end_ts,
    source: "audio",
    track_id: null,
    ...probs(a.probs),
    face_label: null,
    audio_label: a.label,
    fused_label: null,
    speech: a.speech,
  }));
  const rows = [...faceRows, ...audioRows].sort((a, b) => a.ts_ms - b.ts_ms);
  return dataUrl(table(SESSION_COLUMNS, rows, format), format);
}

// --- Webcam sessions (used by ./live, the /ws/live stub) ---

export function startLiveSession(): string {
  ensureStarted();
  const id = `live-${Date.now().toString(36)}`;
  state.live.push({ id, kind: "live", stream_id: null, created_at: Date.now(), duration: 0, status: "running" });
  return id;
}

export function endLiveSession(id: string): void {
  const s = state.live.find((x) => x.id === id);
  if (!s || s.status !== "running") return;
  s.duration = (Date.now() - s.created_at) / 1000;
  s.status = "finished";
}

export const eventSettings = (): AppSettings["events"] => state.settings.events;

export function addEvent(ev: EmotionEvent): void {
  state.events.push(ev);
  broadcast({ type: "event", event: structuredClone(ev) });
}

export { newEventId };

// --- Streams ---

export async function listStreams(_signal?: AbortSignal): Promise<Stream[]> {
  ensureStarted();
  return delay(state.sims.map((s) => s.stream));
}

function findSim(id: string): SimStream | undefined {
  return state.sims.find((s) => s.stream.id === id);
}

const RTSP_RE = /^rtsps?:\/\/\S+$/i;
const RESOLUTION: Record<Stream["camera_type"], [number, number]> = { webcam: [1280, 960], sector: [3840, 2160], security: [2560, 1440] };

/** Opens the stream as the server does once it connects: resolution, session, `running`. */
function goLive(sim: SimStream) {
  const s = sim.stream;
  s.state = "running";
  s.source_resolution ??= RESOLUTION[s.camera_type];
  s.decode = "nvdec";
  if (!s.session_id) {
    s.session_id = `rtsp-${s.id}-${Date.now().toString(36)}`;
    state.rtspStarted.set(s.session_id, Date.now());
  }
  broadcast({ type: "stream_status", stream_id: s.id, state: "running" });
}

export async function createStream(body: NewStream): Promise<Stream> {
  ensureStarted();
  if (!body.name.trim() || !RTSP_RE.test(body.url.trim())) return fail("Укажите название и адрес вида rtsp://…");
  const id = `cam${Date.now().toString(36)}`;
  const stream: Stream = {
    id,
    name: body.name.trim(),
    site: body.site.trim(),
    url: body.url.trim(),
    camera_type: body.camera_type,
    settings: { ...DEFAULT_STREAM_SETTINGS, ...body.settings },
    state: "connecting",
    fps: 0,
    has_audio: body.camera_type !== "security",
    source_resolution: null,
    decode: null,
    session_id: null,
  };
  const sim = newSim(stream, body.camera_type === "webcam" ? 0.2 : 0.05, 2);
  state.sims.push(sim);
  broadcast({ type: "stream_status", stream_id: id, state: "connecting" });
  setTimeout(() => {
    if (state.sims.includes(sim) && stream.settings.enabled) goLive(sim); // not deleted or disabled meanwhile
  }, 2500);
  return delay(stream);
}

export async function updateStream(id: string, patch: StreamPatch): Promise<Stream> {
  const sim = findSim(id);
  if (!sim) return fail("Поток не найден");
  const { settings, ...rest } = patch;
  Object.assign(sim.stream, rest);
  if (settings) sim.stream.settings = { ...sim.stream.settings, ...settings };
  if (!sim.stream.settings.enabled) {
    sim.stream.state = "stopped";
    sim.tracks = [];
    broadcast({ type: "stream_status", stream_id: id, state: "stopped" });
  } else if (sim.stream.state === "stopped") {
    goLive(sim);
  }
  return delay(sim.stream);
}

export async function deleteStream(id: string): Promise<void> {
  if (!findSim(id)) return fail("Поток не найден");
  state.sims = state.sims.filter((s) => s.stream.id !== id);
  broadcast({ type: "stream_status", stream_id: id, state: "stopped" });
  return delay(undefined);
}

/** Reconnect of a demo camera always ends in `error` after 3 s: the stub has no source to reach. */
export async function reconnectStream(id: string): Promise<void> {
  const sim = findSim(id);
  if (!sim) return fail("Поток не найден");
  if (!sim.stream.settings.enabled) return fail("Анализ этой камеры выключен");
  sim.stream.state = "reconnecting";
  broadcast({ type: "stream_status", stream_id: id, state: "reconnecting" });
  setTimeout(() => {
    if (sim.stream.state !== "reconnecting") return;
    sim.stream.state = "error";
    broadcast({ type: "stream_status", stream_id: id, state: "error", message: "Источник не отвечает (заглушка)" });
  }, 3000);
  return delay(undefined);
}

/** Any rtsp:// address passes, except ones containing `unreachable` or `0.0.0.0`. */
export async function testStream(url: string): Promise<StreamTestResult> {
  const u = url.trim();
  if (!RTSP_RE.test(u)) return delay({ ok: false, error: "Адрес должен начинаться с rtsp://" }, 600);
  if (/unreachable|0\.0\.0\.0/.test(u)) return delay({ ok: false, error: "Нет ответа от камеры" }, 1200);
  return delay({ ok: true, resolution: [1920, 1080], has_audio: true }, 900);
}

export async function fetchStreamLog(id: string, intervalS: number, limit = 50): Promise<StreamLogRow[]> {
  const sim = findSim(id);
  if (!sim || sim.stream.state !== "running") return delay([]);
  const r = rng(id.length * 31 + intervalS);
  const now = Math.floor(Date.now() / (intervalS * 1000)) * intervalS * 1000;
  const rows: StreamLogRow[] = [];
  for (let i = 0; i < Math.min(limit, 12); i++) {
    const neg = Math.min(0.95, Math.max(0.03, 0.25 + (r() - 0.5) * 0.6 + (i === 0 && id === "cam1" ? 0.6 : 0)));
    const smallFaces = sim.faceShare < 0.02;
    const decision = smallFaces && r() < 0.6 ? "abstain" : neg >= 0.8 ? "alert" : neg >= 0.6 ? "watch" : r() < 0.15 ? "positive" : "none";
    rows.push({
      from_ts: now - (i + 1) * intervalS * 1000,
      to_ts: now - i * intervalS * 1000,
      clients: Math.max(1, sim.maxTracks - (r() < 0.3 ? 1 : 0)),
      dominant_emotion: neg >= 0.6 ? (r() < 0.6 ? "anger" : "sadness") : decision === "positive" ? "happiness" : "neutral",
      negative_prob: neg,
      decision,
    });
  }
  return delay(rows);
}

// --- Events ---

function matches(e: EmotionEvent, f: EventFilters): boolean {
  return (
    (!f.kind || e.kind === f.kind) &&
    (!f.state || e.state === f.state) &&
    (!f.stream_id || e.stream_id === f.stream_id) &&
    (!f.session_id || e.session_id === f.session_id) &&
    (f.from_ms === undefined || e.emit_ts >= f.from_ms) &&
    (f.to_ms === undefined || e.emit_ts <= f.to_ms)
  );
}

function filterEvents(f: EventFilters): EmotionEvent[] {
  const sorted = state.events.filter((e) => matches(e, f)).sort((a, b) => b.emit_ts - a.emit_ts);
  let start = 0;
  if (f.before_id) {
    const i = sorted.findIndex((e) => e.event_id === f.before_id);
    start = i < 0 ? sorted.length : i + 1;
  }
  return sorted.slice(start, start + (f.limit ?? 200));
}

export async function listEvents(f: EventFilters, _signal?: AbortSignal): Promise<EmotionEvent[]> {
  ensureStarted();
  return delay(filterEvents(f));
}

export async function ackEvent(id: string, st: "confirmed" | "false_alarm"): Promise<EmotionEvent> {
  const ev = state.events.find((e) => e.event_id === id);
  if (!ev) return fail("Событие не найдено");
  if (ev.kind !== "negative") return fail("Подтверждать можно только негативные события");
  ev.state = st;
  broadcast({ type: "event", event: structuredClone(ev) });
  return delay(ev);
}

const EVENT_COLUMNS = ["event_id", "kind", "session_id", "stream_id", "camera_type", "track_id", "start_ts", "emit_ts", "duration_ms", "emotion", "group_prob", "state"] as const;

export function exportEvents(f: EventFilters, format: ExportFormat): { url: string; filename: string } {
  ensureStarted();
  const rows = filterEvents({ ...f, limit: Number.MAX_SAFE_INTEGER, before_id: undefined });
  return { url: dataUrl(table(EVENT_COLUMNS, rows as unknown as Record<string, unknown>[], format), format), filename: `events.${format}` };
}

// --- Settings ---

export async function fetchSettings(): Promise<AppSettings> {
  return delay(state.settings);
}

export async function saveSettings(s: AppSettings): Promise<AppSettings> {
  state.settings = structuredClone(s);
  return delay(state.settings);
}

// --- System ---

let load: SystemLoad = { server_ts: Date.now(), cpu_pct: 42, ram_used_mb: 7400, ram_total_mb: 15800, gpu_util_pct: 55, vram_used_mb: 1350, vram_total_mb: 4096 };
function nextLoad(): SystemLoad {
  const j = (v: number, d: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v + (rnd() - 0.5) * d));
  load = {
    ...load,
    server_ts: Date.now(),
    cpu_pct: j(load.cpu_pct, 6, 20, 90),
    ram_used_mb: j(load.ram_used_mb, 80, 6000, 9000),
    gpu_util_pct: j(load.gpu_util_pct ?? 50, 8, 25, 95),
    vram_used_mb: j(load.vram_used_mb ?? 1300, 20, 1200, 1600),
  };
  return load;
}

export async function fetchSystem(_signal?: AbortSignal): Promise<SystemLoad> {
  return delay(nextLoad());
}

// --- /ws/streams emitter ---

type Listener = (msg: StreamsMessage) => void;
const listeners = new Set<Listener>();
const frameListeners = new Set<(f: StreamFrame) => void>();
let wsTimers: number[] = [];
const lastFaces = new Map<string, StreamFace[]>(); // stream id -> faces of its latest result

function broadcast(msg: StreamsMessage) {
  for (const l of listeners) l(msg);
}

let frameCanvas: HTMLCanvasElement | null = null;

/** A synthetic analysed frame (JPEG, longest side 640): backdrop, camera name, clock, a head per face. */
async function renderFrame(sim: SimStream): Promise<Uint8Array | null> {
  const [w, h] = frameSize(sim.stream.source_resolution);
  frameCanvas ??= document.createElement("canvas");
  const c = frameCanvas;
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const hue = [...sim.stream.id].reduce((s, ch) => s + ch.charCodeAt(0), 0) * 37 % 360;
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, `hsl(${hue} 18% 26%)`);
  bg.addColorStop(1, `hsl(${hue} 22% 12%)`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  for (const f of lastFaces.get(sim.stream.id) ?? []) {
    const [x, y, bw, bh] = f.box;
    ctx.fillStyle = "hsl(25 30% 62%)";
    ctx.beginPath();
    ctx.ellipse(x + bw / 2, y + bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsl(${hue} 15% 40%)`;
    ctx.beginPath();
    ctx.ellipse(x + bw / 2, y + bh * 1.9, bw * 1.1, bh * 0.75, 0, Math.PI, 0);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "14px monospace";
  ctx.fillText(`${sim.stream.name} · ${new Date().toLocaleTimeString("ru-RU")}`, 10, h - 12);
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/jpeg", 0.7));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

async function emitFrames() {
  for (const sim of state.sims) {
    if (sim.stream.state !== "running" || frameListeners.size === 0) continue;
    const jpeg = await renderFrame(sim);
    if (!jpeg) return; // no canvas (tests)
    const frame = { stream_id: sim.stream.id, frame_id: sim.frameId, jpeg };
    for (const l of frameListeners) l(frame);
  }
}

function startEmitter() {
  ensureStarted();
  wsTimers.push(
    window.setInterval(() => {
      const now = Date.now();
      for (const sim of state.sims) {
        if (sim.stream.state !== "running") continue;
        const { result, events } = stepStream(sim, rnd, now, state.settings.events, newEventId);
        sim.stream.fps = result.fps;
        lastFaces.set(sim.stream.id, result.faces);
        broadcast(result);
        for (const ev of events) addEvent(ev);
      }
    }, 200),
    window.setInterval(() => broadcast({ type: "system", ...nextLoad() }), 1000),
    window.setInterval(() => void emitFrames(), 1000),
  );
  // initial statuses, like the server does on connect
  setTimeout(() => {
    for (const sim of state.sims) broadcast({ type: "stream_status", stream_id: sim.stream.id, state: sim.stream.state });
  }, 50);
}

/** Stub of `/ws/streams`: the same text messages plus a synthetic JPEG per running stream each second. */
export function connectStreams(onMessage: Listener, onFrame?: (f: StreamFrame) => void, onConnection?: (e: ConnectionEvent) => void): () => void {
  listeners.add(onMessage);
  if (onFrame) frameListeners.add(onFrame);
  setTimeout(() => onConnection?.({ type: "open", first: true }), 0);
  if (listeners.size === 1) startEmitter();
  else for (const sim of state.sims) onMessage({ type: "stream_status", stream_id: sim.stream.id, state: sim.stream.state });
  return () => {
    listeners.delete(onMessage);
    if (onFrame) frameListeners.delete(onFrame);
    if (listeners.size === 0) {
      wsTimers.forEach((t) => window.clearInterval(t));
      wsTimers = [];
    }
  };
}

// --- File analysis ---

const PROGRESS_PER_S = 0.1; // a queued file takes about 10 s to analyse

function tickFiles() {
  const processing = state.files.find((f) => f.status === "processing");
  if (processing) {
    processing.progress = Math.min(1, (processing.progress ?? 0) + PROGRESS_PER_S);
    if (processing.progress >= 1) {
      processing.status = "done";
      processing.usable_pct = 58;
      buildFileResult(processing);
    }
    return;
  }
  const queued = state.files.filter((f) => f.status === "queued").sort((a, b) => a.created_at - b.created_at)[0];
  if (queued) {
    queued.status = "processing";
    queued.progress = 0;
  }
}

export async function listFileSessions(_signal?: AbortSignal): Promise<FileSession[]> {
  ensureStarted();
  return delay([...state.files].sort((a, b) => b.created_at - a.created_at), 80);
}

export async function fetchFileSession(id: string): Promise<FileSession> {
  ensureStarted();
  const f = state.files.find((x) => x.id === id);
  return f ? delay(f, 80) : fail("Сессия не найдена");
}

/** Duration and size of a local video, read by the browser; null if it cannot play the file. */
function probeVideo(file: File): Promise<{ url: string; duration_ms: number; resolution: [number, number] } | null> {
  if (typeof URL.createObjectURL !== "function") return Promise.resolve(null);
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      v.onloadedmetadata = v.onerror = null;
      const ms = v.duration * 1000;
      if (ok && Number.isFinite(ms) && ms > 0 && v.videoWidth > 0) {
        resolve({ url, duration_ms: Math.round(ms), resolution: [v.videoWidth, v.videoHeight] });
      } else {
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };
    const timer = window.setTimeout(() => done(false), 5000);
    v.preload = "metadata";
    v.onloadedmetadata = () => done(true);
    v.onerror = () => done(false);
    v.src = url;
  });
}

/** The upload stays in the browser: the file plays from an object URL, its result is simulated. */
export async function uploadFile(file: File, onProgress?: UploadProgress): Promise<FileSession> {
  ensureStarted();
  for (const sent of [0.25, 0.5, 0.75, 1]) {
    await wait(150);
    onProgress?.(sent);
  }
  const meta = await probeVideo(file);
  const f: FileSession = {
    id: `file-${Date.now().toString(36)}-${Math.floor(rnd() * 1e6)}`,
    file_name: file.name,
    created_at: Date.now(),
    status: "queued",
    progress: null,
    duration_ms: meta?.duration_ms ?? 60_000 + Math.round(rnd() * 240_000),
    resolution: meta?.resolution ?? [1920, 1080],
    notes: meta ? [] : ["playback_unavailable"],
    error: null,
    usable_pct: null,
  };
  if (meta) state.media.set(f.id, meta.url);
  state.files.push(f);
  return delay(f, 100);
}

export async function fetchTimeline(id: string): Promise<Timeline> {
  const t = state.timelines.get(id);
  return t ? delay(t, 200) : fail("Результат ещё не готов");
}

/** Uploaded files play from their object URL; demo files have none (an empty source the player reports). */
export const mediaUrl = (id: string): string => state.media.get(id) ?? "data:video/mp4;base64,";

/** Test hook: resets the stub to its seeded state. */
export function __resetStub() {
  clearInterval(filesTimer);
  started = false;
  state.sims = DEMO_STREAMS.map((d) => newSim(demoStream(d), d.faceShare, d.tracks));
  state.settings = structuredClone(DEFAULT_SETTINGS);
  state.events = [];
  state.files = [];
  state.timelines.clear();
  state.media.clear();
  state.live = [];
  state.rtspStarted.clear();
  lastFaces.clear();
}
