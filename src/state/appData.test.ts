import { afterEach, describe, expect, it, vi } from "vitest";
import { api, DEFAULT_STREAM_SETTINGS, type EmotionEvent, type Stream, type StreamsMessage } from "../api";
import type { ConnectionEvent } from "../api/streamsSocket";
import { AppData, knownIncidents } from "./appData";

const stream: Stream = {
  id: "cam1", name: "Ресепшн", site: "Тверская", url: "rtsp://x", camera_type: "sector", settings: DEFAULT_STREAM_SETTINGS,
  state: "running", fps: 5, has_audio: true, source_resolution: [1920, 1080], session_id: "s1",
};

const incident: EmotionEvent = {
  event_id: "e1", kind: "negative", session_id: "s1", stream_id: "cam1", camera_type: "sector", track_id: 3,
  start_ts: 1, emit_ts: 2, duration_ms: 2000, emotion: "anger", group_prob: 0.8, state: "new",
};

/** AppData wired to a stub socket; returns a function that pushes /ws/streams messages. */
async function wired(): Promise<{ data: AppData; push: (m: StreamsMessage) => void; conn: (e: ConnectionEvent) => void }> {
  let push: (m: StreamsMessage) => void = () => {};
  let conn: (e: ConnectionEvent) => void = () => {};
  vi.spyOn(api, "connectStreams").mockImplementation((onMessage, _onFrame, onConnection) => {
    push = onMessage;
    conn = onConnection ?? conn;
    return () => {};
  });
  vi.spyOn(api, "listStreams").mockResolvedValue([stream]);
  vi.spyOn(api, "listEvents").mockResolvedValue([]);
  vi.stubGlobal("window", { setTimeout: (f: () => void) => (f(), 0) }); // emitThrottled runs at once
  const data = new AppData();
  data.start();
  await data.refreshStreams();
  return { data, push: (m) => push(m), conn: (e) => conn(e) };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AppData /ws/streams handling", () => {
  it("adds a new negative event to the bell and removes it once acknowledged elsewhere", async () => {
    const { data, push } = await wired();
    push({ type: "event", event: incident });
    expect(data.newIncidents.map((e) => e.event_id)).toEqual(["e1"]);
    expect(data.incidentFor("cam1")?.event_id).toBe("e1");
    push({ type: "event", event: { ...incident, state: "false_alarm" } });
    expect(data.newIncidents).toEqual([]);
    push({ type: "event", event: { ...incident, event_id: "p1", kind: "positive", state: null } });
    expect(data.newIncidents).toEqual([]);
  });

  it("replaces an incident in place when its episode ends (same id resent with whole-episode values)", async () => {
    const { data, push } = await wired();
    push({ type: "event", event: incident });
    push({ type: "event", event: { ...incident, event_id: "e2", emit_ts: 3 } });
    expect(data.newIncidents.map((e) => e.event_id)).toEqual(["e2", "e1"]);
    push({ type: "event", event: { ...incident, duration_ms: 9000 } });
    expect(data.newIncidents.map((e) => [e.event_id, e.duration_ms])).toEqual([["e2", 2000], ["e1", 9000]]);
  });

  it("applies stream status and clears the stream's stats when it stops running", async () => {
    const { data, push } = await wired();
    push({ type: "stream_result", stream_id: "cam1", frame_id: 1, decode_ts: Date.now() - 100, emit_ts: Date.now(), faces: [], audio: null, fps: 5 });
    expect(data.feed("cam1").stats.p50).not.toBeNull();
    const before = vi.mocked(api.listStreams).mock.calls.length;
    push({ type: "stream_status", stream_id: "cam1", state: "error" });
    expect(data.stream("cam1")?.state).toBe("error");
    expect(data.feed("cam1").result).toBeNull();
    expect(data.feed("cam1").stats.p50).toBeNull();
    // the stub window runs timers at once; the real one coalesces a burst into one reload
    expect(vi.mocked(api.listStreams).mock.calls.length).toBe(before + 1);
    push({ type: "stream_status", stream_id: "cam1", state: "running" });
    expect(vi.mocked(api.listStreams).mock.calls.length).toBe(before + 2);
  });

  it("corrects latency by the server clock offset from system messages", async () => {
    const { data, push } = await wired();
    const now = Date.now();
    // server clock runs 5 s behind the client
    push({ type: "system", server_ts: now - 5000, cpu_pct: 1, ram_used_mb: 1, ram_total_mb: 2, gpu_util_pct: null, vram_used_mb: null, vram_total_mb: null });
    push({ type: "stream_result", stream_id: "cam1", frame_id: 1, decode_ts: now - 5000 - 200, emit_ts: now - 5000, faces: [], audio: null, fps: 5 });
    const p50 = data.feed("cam1").stats.p50!;
    expect(p50).toBeGreaterThanOrEqual(190);
    expect(p50).toBeLessThan(400);
  });
});

describe("AppData connection handling", () => {
  it("drops stale feeds while disconnected and reloads streams and incidents after a reconnect", async () => {
    const { data, push, conn } = await wired();
    push({ type: "stream_result", stream_id: "cam1", frame_id: 1, decode_ts: Date.now() - 50, emit_ts: Date.now(), faces: [], audio: null, fps: 5 });
    expect(data.feed("cam1").result).not.toBeNull();
    conn({ type: "closed" });
    expect(data.feed("cam1").result).toBeNull();
    const streams = vi.mocked(api.listStreams).mock.calls.length;
    const events = vi.mocked(api.listEvents).mock.calls.length;
    conn({ type: "open", first: false });
    expect(vi.mocked(api.listStreams).mock.calls.length).toBe(streams + 1);
    expect(vi.mocked(api.listEvents).mock.calls.length).toBe(events + 1);
    conn({ type: "open", first: true }); // the first open needs no reload
    expect(vi.mocked(api.listStreams).mock.calls.length).toBe(streams + 1);
  });
});

describe("knownIncidents", () => {
  it("hides incidents of streams that do not exist", () => {
    const other = { ...incident, event_id: "e2", stream_id: "ghost" };
    const file = { ...incident, event_id: "e3", stream_id: null };
    expect(knownIncidents([incident, other, file], [stream]).map((e) => e.event_id)).toEqual(["e1", "e3"]);
    expect(knownIncidents([other], null)).toHaveLength(1);
  });
});
