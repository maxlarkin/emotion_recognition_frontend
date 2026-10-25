import { describe, expect, it } from "vitest";
import type { EmotionEvent, StreamFace, Timeline } from "../api/types";
import { EMOTIONS } from "../live/protocol";
import { rejectReason, statusText } from "./AnalyzePage";
import { episodeAt, frameAt, groupSeries, noFaceSegments, toEpisodes } from "./episodes";

const p = Object.fromEntries(EMOTIONS.map((e) => [e, e === "anger" ? 0.6 : e === "happiness" ? 0.1 : e === "neutral" ? 0.3 : 0])) as StreamFace["fused"];
const face: StreamFace = { track_id: 1, box: [0, 0, 1, 1], face: p, face_label: "anger", fused: p, fused_label: "anger", confidence: 0.6, decision: "watch", face_px: 80 };

function frames(pattern: string): Timeline["frames"] {
  // one char per 200 ms: "x" = face, "." = none
  return [...pattern].map((c, i) => ({ ts_ms: i * 200, width: 640, height: 360, faces: c === "x" ? [face] : [] }));
}

describe("file result helpers", () => {
  it("finds no-face runs of at least one second", () => {
    expect(noFaceSegments(frames("xx.....xx..x"))).toEqual([{ start: 400, end: 1400 }]);
    expect(noFaceSegments(frames("x......"))).toEqual([{ start: 200, end: 1200 }]);
    expect(noFaceSegments(frames("xxxx"))).toEqual([]);
  });

  it("turns session events into sorted episodes", () => {
    const ev = (id: string, start: number, kind: EmotionEvent["kind"]): EmotionEvent => ({
      event_id: id, kind, session_id: "f", stream_id: null, camera_type: null, track_id: 3, start_ts: start, emit_ts: start + 2000,
      duration_ms: 3000, emotion: kind === "negative" ? "anger" : "happiness", group_prob: 0.8, state: kind === "negative" ? "new" : null,
    });
    const eps = toEpisodes([ev("b", 9000, "positive"), ev("a", 1000, "negative")]);
    expect(eps.map((e) => [e.id, e.start, e.end])).toEqual([["a", 1000, 4000], ["b", 9000, 12000]]);
    expect(episodeAt(eps, 2500)?.id).toBe("a");
    expect(episodeAt(eps, 5000)).toBeUndefined();
  });

  it("averages group probabilities per bucket", () => {
    const s = groupSeries(frames("xx.."), 2, 800);
    expect(s[0].negative).toBeCloseTo(0.6);
    expect(s[0].positive).toBeCloseTo(0.1);
    expect(s[0].neutral).toBeCloseTo(0.3);
    expect(s[1].faces).toBe(false);
  });

  it("finds the frame shown at a playback position", () => {
    const f = frames("x.x");
    expect(frameAt(f, 450)?.ts_ms).toBe(400);
    expect(frameAt(f, 0)?.ts_ms).toBe(0);
    expect(frameAt([], 100)).toBeNull();
  });
});

describe("upload queue", () => {
  it("rejects unsupported formats and oversized files before upload", () => {
    expect(rejectReason({ name: "notes.txt", size: 10 })).toBe("Неподдерживаемый формат");
    expect(rejectReason({ name: "clip.MKV", size: 10 })).toBeNull();
    expect(rejectReason({ name: "big.mp4", size: 3 * 1024 ** 3 })).toBe("Файл больше 2 ГБ");
  });

  it("shows queue statuses", () => {
    expect(statusText({ status: "processing", progress: 0.64 })).toBe("Обработка 64 %");
    expect(statusText({ status: "queued", progress: null })).toBe("В очереди");
    expect(statusText({ status: "done", progress: 1 })).toBe("Готово");
  });
});
