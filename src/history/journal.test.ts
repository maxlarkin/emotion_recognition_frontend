import { describe, expect, it } from "vitest";
import { EMOTIONS } from "../live/protocol";
import type { FaceResult } from "../api/types";
import { boxLabel, cameraName } from "../ui/format";
import { endOfMinute, filtersFromParams, toLocalInput } from "./EventsJournal";

describe("journal filters", () => {
  it("reads filters from the URL and ignores invalid values", () => {
    expect(filtersFromParams(new URLSearchParams("kind=negative&state=new&stream=cam1&from=10&to=20"))).toEqual({
      kind: "negative", state: "new", stream_id: "cam1", from_ms: 10, to_ms: 20,
    });
    expect(filtersFromParams(new URLSearchParams("kind=bad&state=x&from=abc"))).toEqual({});
  });

  it("does not crash on out-of-range dates and includes the whole end minute", () => {
    expect(toLocalInput(1e20)).toBe("");
    expect(toLocalInput(undefined)).toBe("");
    const end = Number(endOfMinute("2026-10-10T14:05"));
    expect(end - new Date("2026-10-10T14:05").getTime()).toBe(59_999);
  });

  it("names the source: stream, webcam or the analysed file", () => {
    const files = new Map([["f1", "clip.mp4"]]);
    expect(cameraName({ stream_id: null, emit_ts: 246_000, session_id: "f1" }, null, files)).toBe("clip.mp4");
    expect(cameraName({ stream_id: null, emit_ts: Date.UTC(2026, 9, 10), session_id: "live1" }, null, files)).toBe("Веб-камера");
  });
});

describe("live box label", () => {
  it("shows the negative-group probability like stream boxes", () => {
    const p = Object.fromEntries(EMOTIONS.map((e) => [e, 0])) as FaceResult["fused"];
    p.anger = 0.5;
    p.sadness = 0.41;
    p.neutral = 0.09;
    const face: FaceResult = { track_id: 4, box: [0, 0, 1, 1], face: p, face_label: "anger", fused: p, fused_label: "anger", confidence: 0.5 };
    expect(boxLabel(face)).toBe("#4 · 0,91");
    expect(boxLabel({ ...face, decision: "abstain" } as FaceResult)).toBe("#4 · ?");
  });
});
