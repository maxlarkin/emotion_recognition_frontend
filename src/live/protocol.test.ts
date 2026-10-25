import { describe, expect, it } from "vitest";
import {
  AUDIO_HEADER_BYTES,
  EMOTIONS,
  encodeAudio,
  encodeFrame,
  encodeFrameHeader,
  parseAudio,
  parseServerMessage,
  type FrameResult,
  VIDEO_HEADER_BYTES,
} from "./protocol";

describe("encodeFrameHeader", () => {
  it("lays out 0x01 | f64 LE capture_ts | u32 LE frame_id", () => {
    // Same bytes as backend tests/test_ws_live.py::test_header_matches_client_layout
    expect(Array.from(encodeFrameHeader(1.5, 258))).toEqual([0x01, 0, 0, 0, 0, 0, 0, 0xf8, 0x3f, 0x02, 0x01, 0, 0]);
  });

  it("round-trips a realistic timestamp and the full u32 range", () => {
    const h = encodeFrameHeader(1727780000123.4, 4_000_000_000);
    const v = new DataView(h.buffer);
    expect(h.byteLength).toBe(VIDEO_HEADER_BYTES);
    expect(v.getFloat64(1, true)).toBe(1727780000123.4);
    expect(v.getUint32(9, true)).toBe(4_000_000_000);
  });

  it("appends the JPEG bytes", () => {
    const msg = encodeFrame(2, 7, new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    expect(msg.byteLength).toBe(VIDEO_HEADER_BYTES + 3);
    expect(Array.from(msg.slice(VIDEO_HEADER_BYTES))).toEqual([0xff, 0xd8, 0xff]);
  });
});

describe("parseServerMessage", () => {
  const probs = { anger: 0, disgust: 0, fear: 0, happiness: 0.81, sadness: 0, surprise: 0, neutral: 0.19 };
  const face = {
    track_id: 1,
    box: [10, 20, 30, 40],
    face: probs,
    face_label: "happiness",
    fused: probs,
    fused_label: "happiness",
    confidence: 0.81,
  };

  it("types frame_result, session and error", () => {
    const fr = parseServerMessage(
      JSON.stringify({ type: "frame_result", frame_id: 3, capture_ts: 1.5, proc_ms: 4, faces: [face], audio: null }),
    );
    expect(fr?.type).toBe("frame_result");
    expect(parseServerMessage('{"type":"session","session_id":"ab"}')).toEqual({ type: "session", session_id: "ab" });
    expect(parseServerMessage('{"type":"error","message":"Сессия не начата"}')).toEqual({
      type: "error",
      message: "Сессия не начата",
    });
  });

  it("rejects malformed messages", () => {
    expect(parseServerMessage("{oops")).toBeNull();
    expect(parseServerMessage('{"type":"other"}')).toBeNull();
    expect(parseServerMessage('{"type":"frame_result","frame_id":1,"capture_ts":1,"faces":[{"box":[1,2]}]}')).toBeNull();
    const frame = (f: object) => JSON.stringify({ type: "frame_result", frame_id: 1, capture_ts: 1, faces: [f], audio: null });
    expect(parseServerMessage(frame({ ...face, face: { anger: 1 } }))).toBeNull(); // probs missing keys
    expect(parseServerMessage(frame({ ...face, face_label: "joy" }))).toBeNull();
    expect(parseServerMessage(frame({ ...face, track_id: "1" }))).toBeNull();
  });
});

describe("encodeAudio", () => {
  it("lays out 0x02 | f64 LE capture_ts | PCM16 LE", () => {
    // Same bytes as backend tests/test_ws_live.py::test_audio_header_matches_client_layout
    expect(Array.from(encodeAudio(1.5, Int16Array.of(1, -2)))).toEqual([
      0x02, 0, 0, 0, 0, 0, 0, 0xf8, 0x3f, 0x01, 0x00, 0xfe, 0xff,
    ]);
  });

  it("500 ms chunk: header + 16000 bytes, realistic timestamp", () => {
    const msg = encodeAudio(1727780000123.4, new Int16Array(8000));
    expect(msg.byteLength).toBe(AUDIO_HEADER_BYTES + 16000);
    expect(new DataView(msg.buffer).getFloat64(1, true)).toBe(1727780000123.4);
  });
});

describe("parseAudio", () => {
  const probs = { anger: 0.1, disgust: 0, fear: 0, happiness: 0.25, sadness: 0.05, surprise: 0, neutral: 0.6 };
  const zeros = Object.fromEntries(EMOTIONS.map((k) => [k, 0]));

  it("speech window", () => {
    expect(parseAudio({ speech: true, probs, label: "neutral", window_end_ts: 5 })).toEqual({
      speech: true,
      probs,
      label: "neutral",
      window_end_ts: 5,
    });
  });

  it("silent window: zeros and no label", () => {
    expect(parseAudio({ speech: false, probs: zeros, label: null, window_end_ts: 5 })).toEqual({
      speech: false,
      probs: zeros,
      label: null,
      window_end_ts: 5,
    });
  });

  it("null and malformed blocks give null", () => {
    expect(parseAudio(null)).toBeNull();
    expect(parseAudio({ speech: true, probs: { anger: 1 }, label: "anger" })).toBeNull(); // missing keys
    expect(parseAudio({ speech: true, probs, label: "joy" })).toBeNull();
    expect(parseAudio({ speech: true, probs, label: null })).toBeNull();
    expect(parseAudio({ speech: "yes", probs, label: null })).toBeNull();
    expect(parseAudio({ speech: true, probs, label: "neutral" })).toBeNull(); // no window_end_ts
    expect(parseAudio({ speech: false, probs: zeros, label: null, window_end_ts: "5" })).toBeNull();
  });

  it("frame_result carries the parsed block; a malformed one does not drop the frame", () => {
    const base = { type: "frame_result", frame_id: 1, capture_ts: 2, proc_ms: 3, faces: [] };
    const ok = parseServerMessage(JSON.stringify({ ...base, audio: { speech: true, probs, label: "neutral", window_end_ts: 9 } }));
    expect((ok as FrameResult).audio?.label).toBe("neutral");
    const bad = parseServerMessage(JSON.stringify({ ...base, audio: { speech: true, probs, label: "neutral" } }));
    expect(bad).not.toBeNull();
    expect((bad as FrameResult).audio).toBeNull();
    expect((parseServerMessage(JSON.stringify({ ...base, audio: null })) as FrameResult).audio).toBeNull();
  });
});
