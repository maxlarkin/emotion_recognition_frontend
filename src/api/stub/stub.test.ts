// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAudio, encodeFrame, parseServerMessage, type FrameResult, type ServerMessage } from "../../live/protocol";
import { DEFAULT_SETTINGS, type StreamsMessage } from "../types";
import * as stub from "./index";
import { jpegSize, openLiveSocket } from "./live";
import { applyRule, makeProbs, newRuleState } from "./sim";

const cfg = DEFAULT_SETTINGS.events;

/** Runs the stub's timers until `p` settles; returns its value or throws its error. */
async function run<T>(p: Promise<T>, ms = 2000): Promise<T> {
  const settled = p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.advanceTimersByTimeAsync(ms);
  const r = await settled;
  if (!r.ok) throw r.error;
  return r.value;
}

const decode = (url: string) => decodeURIComponent(url.slice(url.indexOf(",") + 1));

/** SOI, an empty APP0 and a baseline SOF0 with the given size. */
function fakeJpeg(w: number, h: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, ...new Array<number>(9).fill(0)];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof]);
}

beforeEach(() => {
  vi.useFakeTimers();
  stub.__resetStub();
});
afterEach(() => vi.useRealTimers());

describe("stub event rule (stack.md)", () => {
  it("abstains on small faces and young tracks", () => {
    const st = newRuleState(0);
    expect(applyRule(st, makeProbs(0.9, 0, "anger"), 30, 48, 5000, cfg).decision).toBe("abstain");
    expect(applyRule(newRuleState(0), makeProbs(0.9, 0, "anger"), 90, 48, 500, cfg).decision).toBe("abstain");
  });

  it("watches, then raises one negative event after the minimum duration, then honours the cooldown", () => {
    const st = newRuleState(0);
    const neg = makeProbs(0.8, 0, "anger");
    expect(applyRule(st, neg, 90, 48, 1000, cfg)).toMatchObject({ decision: "watch", emit: null });
    expect(applyRule(st, neg, 90, 48, 3000, cfg)).toMatchObject({ decision: "alert", emit: "negative" });
    st.openNegative = "e1";
    expect(applyRule(st, makeProbs(0.1, 0, "anger"), 90, 48, 4000, cfg)).toMatchObject({ decision: "none", closeNegative: true });
    applyRule(st, neg, 90, 48, 5000, cfg);
    expect(applyRule(st, neg, 90, 48, 8000, cfg).emit).toBeNull(); // within 30 s cooldown
  });
});

describe("REST stub", () => {
  it("is healthy with all four models", async () => {
    expect(await run(stub.fetchHealth())).toMatchObject({ status: "ok", models: { yunet: true, fer: true, vad: true, ser: true } });
  });

  it("serves demo streams across several sites, including connecting and offline ones", async () => {
    const list = await run(stub.listStreams());
    expect(new Set(list.map((s) => s.site)).size).toBeGreaterThanOrEqual(2);
    expect(list.some((s) => s.state === "connecting")).toBe(true);
    expect(list.some((s) => s.state === "error")).toBe(true);
  });

  it("adds a stream that goes live with an rtsp session", async () => {
    const s = await run(stub.createStream({ name: "Склад", site: "Арбат", url: "rtsp://192.0.2.9/main", camera_type: "sector" }), 3000);
    const listed = (await run(stub.listStreams())).find((x) => x.id === s.id);
    expect(listed).toMatchObject({ state: "running", source_resolution: [3840, 2160] });
    const sessions = await run(stub.fetchSessions());
    expect(sessions.find((x) => x.stream_id === s.id)).toMatchObject({ kind: "rtsp", status: "running" });
    await expect(run(stub.createStream({ name: "", site: "", url: "http://x", camera_type: "webcam" }))).rejects.toThrow("rtsp://");
  });

  it("lists every session kind and refuses to delete a running one", async () => {
    const sessions = await run(stub.fetchSessions());
    expect(new Set(sessions.map((s) => s.kind))).toEqual(new Set(["live", "rtsp", "file"]));
    const running = sessions.find((s) => s.status === "running")!;
    await expect(run(stub.deleteSession(running.id))).rejects.toThrow("Сессия ещё идёт");
    await run(stub.deleteSession("file-1"));
    expect((await run(stub.fetchSessions())).some((s) => s.id === "file-1")).toBe(false);
    expect(await run(stub.listEvents({ session_id: "file-1" }))).toEqual([]);
  });

  it("exports a file session with the interfaces.md columns, face and audio rows", () => {
    const url = stub.exportUrl("file-1", "csv");
    expect(url.startsWith("data:text/csv;charset=utf-8,")).toBe(true);
    const [head, ...rows] = decode(url).split("\n");
    expect(head).toBe(
      "session_id,stream_id,ts_ms,source,track_id,box_x,box_y,box_w,box_h,p_anger,p_disgust,p_fear,p_happiness,p_sadness,p_surprise,p_neutral,face_label,audio_label,fused_label,speech",
    );
    expect(rows.some((r) => r.split(",")[3] === "face")).toBe(true);
    expect(rows.some((r) => r.split(",")[3] === "audio")).toBe(true);
    expect(JSON.parse(decode(stub.exportUrl("file-1", "json"))).length).toBe(rows.length);
  });

  it("exports the filtered journal", async () => {
    await run(stub.listEvents({})); // seeds the journal
    const { url, filename } = stub.exportEvents({ kind: "positive", limit: 1 }, "json");
    const rows = JSON.parse(decode(url)) as { kind: string }[];
    expect(filename).toBe("events.json");
    expect(rows.length).toBeGreaterThan(1); // paging fields are dropped
    expect(rows.every((r) => r.kind === "positive")).toBe(true);
  });

  it("uploads a file with progress, analyses it and serves its timeline", async () => {
    const sent: number[] = [];
    // jsdom never loads the video: the metadata probe gives up after 5 s
    const f = await run(stub.uploadFile(new File(["x"], "clip.mp4"), (p) => sent.push(p)), 6000);
    expect(sent).toEqual([0.25, 0.5, 0.75, 1]);
    expect(f).toMatchObject({ file_name: "clip.mp4", status: "queued", notes: ["playback_unavailable"] });
    await vi.advanceTimersByTimeAsync(60_000); // the demo queue ahead of it finishes first
    expect(await run(stub.fetchFileSession(f.id))).toMatchObject({ status: "done", progress: 1 });
    expect((await run(stub.fetchTimeline(f.id))).frames.length).toBeGreaterThan(0);
  });

  it("broadcasts an acknowledged incident on /ws/streams", async () => {
    const got: StreamsMessage[] = [];
    const disconnect = stub.connectStreams((m) => got.push(m));
    const [incident] = await run(stub.listEvents({ kind: "negative", state: "new" }));
    await run(stub.ackEvent(incident.event_id, "confirmed"));
    disconnect();
    expect(got.some((m) => m.type === "stream_result")).toBe(true);
    expect(got.some((m) => m.type === "system")).toBe(true);
    expect(got).toContainEqual({ type: "event", event: expect.objectContaining({ event_id: incident.event_id, state: "confirmed" }) });
  });
});

describe("/ws/live stub", () => {
  it("reads the frame size from the JPEG header", () => {
    expect(jpegSize(fakeJpeg(640, 360))).toEqual([640, 360]);
    expect(jpegSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("opens a session, answers frames with a face inside the frame and follows the voice", async () => {
    const ws = openLiveSocket();
    const got: ServerMessage[] = [];
    ws.onopen = () => ws.send(JSON.stringify({ type: "start" }));
    ws.onmessage = (e) => got.push(parseServerMessage(e.data as string)!);
    await vi.advanceTimersByTimeAsync(300);
    expect(got[0]).toMatchObject({ type: "session" });

    ws.send(encodeAudio(1000, new Int16Array(1600).fill(8000)));
    ws.send(encodeFrame(1234.5, 7, fakeJpeg(640, 360)));
    await vi.advanceTimersByTimeAsync(100);
    const loud = got[1] as FrameResult;
    expect(loud).toMatchObject({ type: "frame_result", frame_id: 7, capture_ts: 1234.5 });
    const [x, y, w, h] = loud.faces[0].box;
    expect(x >= 0 && y >= 0 && x + w <= 640 && y + h <= 360).toBe(true);
    expect(loud.audio).toMatchObject({ speech: true, window_end_ts: 1100 });

    ws.send(encodeAudio(2000, new Int16Array(1600)));
    ws.send(encodeFrame(2001, 8, fakeJpeg(640, 360)));
    await vi.advanceTimersByTimeAsync(100);
    expect((got[2] as FrameResult).audio).toMatchObject({ speech: false, label: null });

    ws.close(1000);
    await vi.advanceTimersByTimeAsync(10);
    const live = (await run(stub.fetchSessions())).find((s) => s.id === (got[0] as { session_id: string }).session_id);
    expect(live).toMatchObject({ kind: "live", status: "finished" });
  });
});
