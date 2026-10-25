import { describe, expect, it } from "vitest";
import { EMOTION_WORD } from "../ui/format";
import { containRect, drawOverlay, faceLabel, isStale, scaleBox, STALE_MS } from "./overlay";
import { EMOTIONS, type FaceResult } from "./protocol";

describe("containRect", () => {
  it("letterboxes a 4:3 video in a 16:9 box", () => {
    expect(containRect(640, 480, 1600, 900)).toEqual({ x: 200, y: 0, w: 1200, h: 900 });
  });
  it("pillarboxes nothing for a matching aspect", () => {
    expect(containRect(1280, 720, 640, 360)).toEqual({ x: 0, y: 0, w: 640, h: 360 });
  });
  it("is empty for unknown sizes", () => {
    expect(containRect(0, 0, 640, 360)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("scaleBox", () => {
  it("maps JPEG pixels to the displayed video", () => {
    // 640x360 JPEG of a 1280x720 camera shown 960x540 at offset (20, 10)
    const shown = { x: 20, y: 10, w: 960, h: 540 };
    expect(scaleBox([100, 50, 64, 36], 640, 360, shown)).toEqual({ x: 170, y: 85, w: 96, h: 54 });
  });
});

describe("faceLabel", () => {
  it("shows the Russian emotion and a rounded percentage", () => {
    expect(faceLabel({ fused_label: "happiness", confidence: 0.814 })).toBe("радость 81%");
    expect(faceLabel({ fused_label: "neutral", confidence: 1 })).toBe("нейтрально 100%");
  });
  it("has a Russian name for every emotion key", () => {
    for (const e of EMOTIONS) expect(EMOTION_WORD[e]).toMatch(/^[а-яё]+$/);
  });
});

describe("overlay clearing", () => {
  function stubCtx() {
    const calls: string[] = [];
    const ctx = {
      clearRect: (...a: number[]) => calls.push(`clear ${a.join(",")}`),
      strokeRect: () => calls.push("stroke"),
      fillRect: () => calls.push("fill"),
      fillText: () => calls.push("text"),
      measureText: () => ({ width: 10 }),
    } as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  }

  it("clears the whole canvas and draws nothing when the face has left", () => {
    const { ctx, calls } = stubCtx();
    drawOverlay(ctx, 640, 360, [], 640, 360, { x: 0, y: 0, w: 640, h: 360 });
    expect(calls).toEqual(["clear 0,0,640,360"]);
  });

  it("clears before drawing a new box", () => {
    const { ctx, calls } = stubCtx();
    const p = Object.fromEntries(EMOTIONS.map((e) => [e, e === "happiness" ? 1 : 0])) as FaceResult["face"];
    const face: FaceResult = {
      track_id: 1, box: [10, 10, 50, 50], face: p, face_label: "happiness", fused: p, fused_label: "happiness", confidence: 1,
    };
    drawOverlay(ctx, 640, 360, [face], 640, 360, { x: 0, y: 0, w: 640, h: 360 });
    expect(calls[0]).toBe("clear 0,0,640,360");
    expect(calls).toContain("stroke");
  });

  it("is stale only after more than STALE_MS without a result", () => {
    expect(STALE_MS).toBe(1000);
    expect(isStale(5000, 6000)).toBe(false);
    expect(isStale(5000, 6000.5)).toBe(true);
  });
});
