import { describe, expect, it } from "vitest";
import { dateText, durationText, kindLabel, statusLabel } from "./format";

describe("session format helpers", () => {
  it("labels kinds and statuses in Russian", () => {
    expect(kindLabel("live")).toBe("Веб-камера");
    expect(kindLabel("file")).toBe("Файл");
    expect(kindLabel("rtsp")).toBe("Камера (RTSP)");
    expect(statusLabel("running")).toBe("идёт");
    expect(statusLabel("finished")).toBe("завершена");
    expect(statusLabel("something")).toBe("something");
  });

  it("formats durations", () => {
    expect(durationText(0)).toBe("0 с");
    expect(durationText(45.9)).toBe("45 с");
    expect(durationText(125)).toBe("2 мин 05 с");
    expect(durationText(3725)).toBe("1 ч 02 мин");
    expect(durationText(-1)).toBe("—");
    expect(durationText(Number.NaN)).toBe("—");
  });

  it("formats dates", () => {
    expect(dateText(Date.UTC(2026, 9, 8, 14, 3, 7), "UTC")).toBe("08.10.2026, 14:03:07");
    expect(dateText(Number.NaN)).toBe("—");
  });
});
