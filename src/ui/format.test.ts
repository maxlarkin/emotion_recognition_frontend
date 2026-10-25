import { describe, expect, it } from "vitest";
import { clock, DECISION_LABEL, intervalText, minSec, mmss, percent, prob, statusGroup, STATUS_LABEL, worstDecision } from "./format";

describe("Russian formatting", () => {
  it("uses a decimal comma and a spaced percent", () => {
    expect(prob(0.912)).toBe("0,91");
    expect(prob(0.1)).toBe("0,10");
    expect(percent(72.4)).toBe("72 %");
    expect(percent(null)).toBe("—");
  });

  it("formats durations and positions", () => {
    expect(minSec(80)).toBe("1:20");
    expect(minSec(5)).toBe("0:05");
    expect(minSec(3725)).toBe("1:02:05");
    expect(mmss(65)).toBe("01:05");
    expect(minSec(-1)).toBe("—");
  });

  it("formats interval journal times as чч:мм:сс–мм:сс", () => {
    const from = Date.UTC(2026, 9, 10, 14, 32, 0);
    expect(clock(from, "UTC")).toBe("14:32:00");
    expect(intervalText(from, from + 10_000, "UTC")).toBe("14:32:00–32:10");
  });
});

describe("state labels", () => {
  it("maps wire stream states to three UI groups", () => {
    expect(STATUS_LABEL[statusGroup("running")]).toBe("В эфире");
    expect(STATUS_LABEL[statusGroup("connecting")]).toBe("Подключение");
    expect(STATUS_LABEL[statusGroup("reconnecting")]).toBe("Подключение");
    expect(STATUS_LABEL[statusGroup("stopped")]).toBe("Нет сигнала");
    expect(STATUS_LABEL[statusGroup("error")]).toBe("Нет сигнала");
  });

  it("picks the worst decision: alert > watch > abstain > positive > none", () => {
    expect(worstDecision([])).toBeNull();
    expect(worstDecision(["none", "positive"])).toBe("positive");
    expect(worstDecision(["positive", "abstain", "none"])).toBe("abstain");
    expect(worstDecision(["abstain", "watch"])).toBe("watch");
    expect(worstDecision(["watch", "alert", "none"])).toBe("alert");
    expect(DECISION_LABEL.abstain).toBe("Не уверена");
  });
});

describe("event time", () => {
  it("shows file positions for media timestamps and dates for live ones", async () => {
    const { eventTime } = await import("./format");
    expect(eventTime(246_000)).toBe("запись 04:06");
    expect(eventTime(Date.UTC(2026, 9, 10, 14, 3, 7), "UTC")).toBe("10.10, 14:03:07");
  });
});
