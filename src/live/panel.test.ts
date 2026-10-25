import { describe, expect, it } from "vitest";
import { faceText, fusedText, largestFace, voiceText } from "./panel";
import { EMOTIONS, type AudioBlock, type FaceResult, type Probs } from "./protocol";

const zeros = Object.fromEntries(EMOTIONS.map((k) => [k, 0])) as Probs;
const speech: AudioBlock = { speech: true, probs: { ...zeros, anger: 0.72, neutral: 0.28 }, label: "anger", window_end_ts: 1 };
const silence: AudioBlock = { speech: false, probs: zeros, label: null, window_end_ts: 1 };

function face(w: number, label: FaceResult["face_label"], fused: FaceResult["fused_label"]): FaceResult {
  return {
    track_id: w,
    box: [0, 0, w, w],
    face: { ...zeros, [label]: 0.6 },
    face_label: label,
    fused: { ...zeros, [fused]: 0.55 },
    fused_label: fused,
    confidence: 0.55,
  };
}

describe("voiceText", () => {
  it("follows the mic state first", () => {
    expect(voiceText("off", speech)).toBe("микрофон выключен");
    expect(voiceText("unavailable", speech)).toBe("нет доступа к микрофону");
    expect(voiceText("starting", speech)).toBe("ожидание…");
  });

  it("shows the window: none yet, silence, speech", () => {
    expect(voiceText("on", null)).toBe("ожидание…");
    expect(voiceText("on", silence)).toBe("нет речи");
    expect(voiceText("on", speech)).toBe("злость 72%");
  });
});

describe("largest face", () => {
  it("picks the biggest box and labels face and fused separately", () => {
    const big = face(200, "happiness", "anger");
    const best = largestFace([face(50, "sadness", "sadness"), big, face(120, "fear", "fear")]);
    expect(best).toBe(big);
    expect(faceText(best)).toBe("радость 60%");
    expect(fusedText(best)).toBe("злость 55%");
  });

  it("no face", () => {
    expect(largestFace([])).toBeNull();
    expect(faceText(null)).toBe("лицо не найдено");
    expect(fusedText(null)).toBe("лицо не найдено");
  });
});
