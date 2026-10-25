import { afterEach, describe, expect, it, vi } from "vitest";
import * as real from "./real";
import { deleteSession, fetchSessions } from "./real";

function stubFetch(status: number, body: string, contentType = "application/json") {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status, headers: { "Content-Type": contentType } })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sessions API errors", () => {
  it("throws the Russian detail of a JSON error", async () => {
    stubFetch(409, JSON.stringify({ detail: "Сессия ещё идёт" }));
    await expect(deleteSession("abc")).rejects.toThrow("Сессия ещё идёт");
    stubFetch(404, JSON.stringify({ detail: "Сессия не найдена" }));
    await expect(deleteSession("abc")).rejects.toThrow("Сессия не найдена");
    stubFetch(503, JSON.stringify({ detail: "Хранилище сессий недоступно" }));
    await expect(fetchSessions()).rejects.toThrow("Хранилище сессий недоступно");
  });

  it("falls back to HTTP <status> for a non-JSON error", async () => {
    stubFetch(502, "<html>Bad Gateway</html>", "text/html");
    await expect(fetchSessions()).rejects.toThrow("HTTP 502");
    stubFetch(500, "oops", "text/plain");
    await expect(deleteSession("abc")).rejects.toThrow("HTTP 500");
  });

  it("rejects a malformed list body", async () => {
    stubFetch(200, JSON.stringify({ sessions: [] }));
    await expect(fetchSessions()).rejects.toThrow("некорректный ответ сервера");
    stubFetch(200, JSON.stringify([{ id: 1, created_at: "x" }]));
    await expect(fetchSessions()).rejects.toThrow("некорректный ответ сервера");
  });

  it("returns a well-formed list", async () => {
    const list = [{ id: "a", kind: "live", stream_id: null, created_at: 1, duration: 2, status: "finished" }];
    stubFetch(200, JSON.stringify(list));
    await expect(fetchSessions()).resolves.toEqual(list);
  });
});

/** Records fetch calls and answers each with the next queued response. */
function recordFetch(...responses: [number, unknown][]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const [status, body] = responses.shift() ?? [200, null];
      return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

describe("streams and system adapters (interfaces.md)", () => {
  const stream = {
    id: "s1", name: "Вход", site: "", url: "rtsp://u:***@h/x", camera_type: "sector",
    settings: { enabled: true, analysis_fps: 5, detection_size: "auto", min_face_px: 48 },
    state: "running", fps: 5, has_audio: false, source_resolution: [1920, 1080], decode: "cpu", session_id: "x",
  };

  it("lists, creates (then reads the row back), patches, deletes and reconnects", async () => {
    const calls = recordFetch([200, [stream]], [200, { id: "s1" }], [200, [stream]], [200, stream], [204, null], [204, null]);
    expect(await real.listStreams()).toEqual([stream]);
    expect(await real.createStream({ name: "Вход", site: "", url: "rtsp://h/x", camera_type: "sector" })).toEqual(stream);
    expect(await real.updateStream("s1", { settings: { analysis_fps: 3 } })).toEqual(stream);
    await real.deleteStream("s1");
    await real.reconnectStream("s1");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/streams",
      "POST /api/streams",
      "GET /api/streams",
      "PATCH /api/streams/s1",
      "DELETE /api/streams/s1",
      "POST /api/streams/s1/reconnect",
    ]);
    expect(calls[1].body).toEqual({ name: "Вход", site: "", url: "rtsp://h/x", camera_type: "sector" });
    expect(calls[3].body).toEqual({ settings: { analysis_fps: 3 } });
  });

  it("tests a URL and reads system load", async () => {
    const calls = recordFetch([200, { ok: false, error: "Нет ответа от камеры" }], [200, { server_ts: 1, cpu_pct: 3 }]);
    expect(await real.testStream("rtsp://h/x")).toEqual({ ok: false, error: "Нет ответа от камеры" });
    expect((await real.fetchSystem()).cpu_pct).toBe(3);
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/streams/test", body: { url: "rtsp://h/x" } });
    expect(calls[1].url).toBe("/api/system");
  });

  it("surfaces the Russian detail of a rejected stream", async () => {
    recordFetch([422, { detail: "Адрес должен начинаться с rtsp://" }]);
    await expect(real.createStream({ name: "A", site: "", url: "http://x", camera_type: "sector" })).rejects.toThrow("Адрес должен начинаться с rtsp://");
  });
});

describe("events, settings and stream log adapters (interfaces.md, story 1.11)", () => {
  const event = {
    event_id: "e1", kind: "negative", session_id: "s", stream_id: "cam1", camera_type: "sector", track_id: 3,
    start_ts: 1, emit_ts: 2, duration_ms: 2000, emotion: "anger", group_prob: 0.7, state: "confirmed",
  };
  const settings = {
    events: { negative_emotions: ["anger"], negative_threshold: 0.7, positive_threshold: 0.6, min_duration_s: 2, cooldown_s: 30 },
    journal: { interval_s: 30 },
  };

  it("lists events with filters, limit and before_id in the query", async () => {
    const calls = recordFetch([200, [event]], [200, []]);
    const filters = { kind: "negative", state: "new", stream_id: "cam 1", from_ms: 10, to_ms: 20, limit: 50, before_id: "e9" } as const;
    expect(await real.listEvents(filters)).toEqual([event]);
    await real.listEvents({});
    const q = new URL(calls[0].url, "http://x");
    expect(q.pathname).toBe("/api/events");
    expect(Object.fromEntries(q.searchParams)).toEqual({
      kind: "negative", state: "new", stream_id: "cam 1", from_ms: "10", to_ms: "20", limit: "50", before_id: "e9",
    });
    expect(calls[1].url).toBe("/api/events");
  });

  it("acks with a POST body and returns the event", async () => {
    const calls = recordFetch([200, event]);
    expect(await real.ackEvent("e 1", "confirmed")).toEqual(event);
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/events/e%201/ack", body: { state: "confirmed" } });
  });

  it("builds the export URL from the filters without limit and before_id", async () => {
    const { url, filename } = real.exportEvents({ kind: "positive", session_id: "s", limit: 50, before_id: "e9" }, "json");
    const q = new URL(url, "http://x");
    expect(q.pathname).toBe("/api/events/export");
    expect(Object.fromEntries(q.searchParams)).toEqual({ kind: "positive", session_id: "s", format: "json" });
    expect(filename).toBe("events.json");
  });

  it("reads settings and saves them with PUT", async () => {
    const calls = recordFetch([200, settings], [200, settings]);
    expect(await real.fetchSettings()).toEqual(settings);
    expect(await real.saveSettings(settings as Parameters<typeof real.saveSettings>[0])).toEqual(settings);
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/settings" });
    expect(calls[1]).toMatchObject({ method: "PUT", url: "/api/settings", body: settings });
  });

  it("reads the stream log with interval_s and limit", async () => {
    const rows = [{ from_ts: 0, to_ts: 10000, clients: 1, dominant_emotion: "anger", negative_prob: 0.7, decision: "watch" }];
    const calls = recordFetch([200, rows], [200, []]);
    expect(await real.fetchStreamLog("cam 1", 30, 20)).toEqual(rows);
    await real.fetchStreamLog("cam1", 10);
    expect(calls[0].url).toBe("/api/streams/cam%201/log?interval_s=30&limit=20");
    expect(calls[1].url).toBe("/api/streams/cam1/log?interval_s=10&limit=50");
  });
});

describe("file analysis adapters (interfaces.md, story 1.12)", () => {
  const raw: Parameters<typeof real.toFileSession>[0] = {
    id: "f1", kind: "file", stream_id: null, created_at: 5, duration: 12.5, status: "processing",
    file_name: "зал.mp4", progress: 0.42, duration_ms: 12_500, resolution: [1920, 1080], notes: ["no_audio_track"], error: null,
  };

  it("maps file sessions; an unknown status becomes failed with a message", () => {
    expect(real.toFileSession(raw)).toEqual({
      id: "f1", file_name: "зал.mp4", created_at: 5, status: "processing", progress: 0.42, duration_ms: 12_500,
      resolution: [1920, 1080], notes: ["no_audio_track"], error: null, usable_pct: null,
    });
    const odd = real.toFileSession({ ...raw, status: "paused" });
    expect(odd.status).toBe("failed");
    expect(odd.error).toContain("paused");
    expect(real.toFileSession({ ...raw, status: "failed", error: "Запись длиннее 10 минут" }).error).toBe("Запись длиннее 10 минут");
  });

  it("lists with kind=file and reads usable_pct from the summary", async () => {
    const calls = recordFetch([200, [raw]], [200, { ...raw, status: "done", summary: { usable_pct: 64.5 } }]);
    expect((await real.listFileSessions()).map((f) => f.id)).toEqual(["f1"]);
    const one = await real.fetchFileSession("f 1");
    expect(one.usable_pct).toBe(64.5);
    expect(one.status).toBe("done");
    expect(calls.map((c) => c.url)).toEqual(["/api/sessions?kind=file", "/api/sessions/f%201"]);
  });

  it("builds timeline and media URLs", async () => {
    const calls = recordFetch([200, { frames: [], audio: [] }]);
    await real.fetchTimeline("f1");
    expect(calls[0].url).toBe("/api/sessions/f1/timeline");
    expect(real.mediaUrl("f 1")).toBe("/api/sessions/f%201/media");
  });
});

/** Minimal XMLHttpRequest stand-in: `send` reports upload progress, then answers. */
class FakeXHR {
  static last: FakeXHR | null = null;
  static answer: { status: number; body: string } = { status: 200, body: "{}" };
  method = "";
  url = "";
  sent: unknown = null;
  status = 0;
  responseText = "";
  responseType = "";
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXHR.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: unknown) {
    this.sent = body;
    this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 200 });
    this.upload.onprogress?.({ lengthComputable: true, loaded: 200, total: 200 });
    this.status = FakeXHR.answer.status;
    this.responseText = FakeXHR.answer.body;
    queueMicrotask(() => (this.status === 0 ? this.onerror?.() : this.onload?.()));
  }
}

describe("uploadFile (XHR with upload progress)", () => {
  it("posts multipart field `file`, reports progress and reads the new session", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    FakeXHR.answer = { status: 200, body: JSON.stringify({ session_id: "s9" }) };
    const calls = recordFetch([200, { id: "s9", kind: "file", created_at: 1, duration: 0, status: "queued", file_name: "a.mp4" }]);
    const progress: number[] = [];
    const s = await real.uploadFile(new File(["xyz"], "a.mp4"), (p) => progress.push(p));
    expect(FakeXHR.last).toMatchObject({ method: "POST", url: "/api/files" });
    expect((FakeXHR.last!.sent as FormData).get("file")).toBeInstanceOf(File);
    expect(progress).toEqual([0.25, 1]);
    expect(s).toMatchObject({ id: "s9", status: "queued", file_name: "a.mp4" });
    expect(calls[0].url).toBe("/api/sessions/s9");
  });

  it("rejects with the server's Russian detail, or a network message", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    FakeXHR.answer = { status: 422, body: JSON.stringify({ detail: "Неподдерживаемый формат" }) };
    await expect(real.uploadFile(new File(["x"], "a.mov"))).rejects.toThrow("Неподдерживаемый формат");
    FakeXHR.answer = { status: 413, body: "<html>413 Request Entity Too Large</html>" };
    await expect(real.uploadFile(new File(["x"], "a.mp4"))).rejects.toThrow("Файл больше 2 ГБ");
    FakeXHR.answer = { status: 502, body: "<html>" };
    await expect(real.uploadFile(new File(["x"], "a.mp4"))).rejects.toThrow("HTTP 502");
    FakeXHR.answer = { status: 0, body: "" };
    await expect(real.uploadFile(new File(["x"], "a.mp4"))).rejects.toThrow("нет связи с сервером");
  });
});
