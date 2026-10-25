// @vitest-environment jsdom
// File result sync (CAP-3): picking an episode in the table or on the timeline selects it in both and
// moves the playback position; moving the position (slider, chart, video time) selects the episode under it.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmotionEvent, FileSession, Timeline } from "../api";
import Result from "./Result";

const { fetchTimeline, listEvents, fileMediaUrl } = vi.hoisted(() => ({
  fetchTimeline: vi.fn(),
  listEvents: vi.fn(),
  fileMediaUrl: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: { ...actual.api, fetchTimeline, listEvents, fileMediaUrl, fileExportUrl: () => "blob:x" } };
});

const FILE: FileSession = {
  id: "f1",
  file_name: "зал.mp4",
  created_at: Date.UTC(2026, 9, 1),
  status: "done",
  progress: 1,
  duration_ms: 20_000,
  resolution: [1280, 720],
  notes: [],
  error: null,
  usable_pct: 90,
};

const TIMELINE: Timeline = {
  frames: Array.from({ length: 101 }, (_, i) => ({ ts_ms: i * 200, width: 1280, height: 720, faces: [] })),
  audio: [],
};

function event(id: string, kind: EmotionEvent["kind"], start: number, duration: number, emotion: EmotionEvent["emotion"]): EmotionEvent {
  return { event_id: id, kind, session_id: "f1", stream_id: null, camera_type: null, track_id: 3, start_ts: start, emit_ts: start + duration, duration_ms: duration, emotion, group_prob: 0.8, state: null };
}

// listed out of order: episodes are sorted by start
const EVENTS = [event("pos", "positive", 10_000, 4000, "happiness"), event("neg", "negative", 2000, 3000, "anger")];

async function setup(media = "/media/f1") {
  fileMediaUrl.mockReturnValue(media);
  render(<Result file={FILE} />);
  await screen.findByRole("region", { name: "Эпизоды" });
  return userEvent.setup();
}

const timelineEp = (name: RegExp) => within(screen.getByRole("region", { name: "Шкала времени" })).getByRole("button", { name });
const tableEp = (text: string) => within(screen.getByRole("region", { name: "Эпизоды" })).getByRole("button", { name: text });
const row = (text: string) => tableEp(text).closest("tr")!;
const slider = () => screen.getByRole("slider", { name: "Позиция" }) as HTMLInputElement;
const pressed = (el: HTMLElement) => el.getAttribute("aria-pressed") === "true";

/** Selection seen in both places: [incident on timeline, incident in table, positive on timeline, positive in table]. */
const selection = () => [pressed(timelineEp(/^Инцидент/)), pressed(tableEp("00:02–00:05")), pressed(timelineEp(/^Позитив/)), pressed(tableEp("00:10–00:14"))];

beforeEach(() => {
  fetchTimeline.mockResolvedValue(TIMELINE);
  listEvents.mockResolvedValue(EVENTS);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Result selection sync", () => {
  it("loads the session's timeline and events", async () => {
    await setup();
    expect(fetchTimeline).toHaveBeenCalledWith("f1");
    expect(listEvents).toHaveBeenCalledWith({ session_id: "f1", limit: 1000 });
    expect(timelineEp(/^Инцидент 00:02–00:05, клиент #3$/)).toBeTruthy();
    expect(selection()).toEqual([false, false, false, false]);
    expect(slider().value).toBe("0");
  });

  it("a table row selects the episode on the timeline and seeks the player", async () => {
    const user = await setup();
    await user.click(tableEp("00:10–00:14"));
    expect(selection()).toEqual([false, false, true, true]);
    expect(row("00:10–00:14").className).toContain("selected");
    expect(slider().value).toBe("10000");
    expect(screen.getByText("00:10 / 00:20")).toBeTruthy();

    await user.click(within(row("00:02–00:05")).getByText("Злость")); // anywhere on the row
    expect(selection()).toEqual([true, true, false, false]);
    expect(slider().value).toBe("2000");
  });

  it("a timeline episode selects its table row and seeks the player", async () => {
    const user = await setup();
    await user.click(timelineEp(/^Позитив/));
    expect(selection()).toEqual([false, false, true, true]);
    expect(timelineEp(/^Позитив/).className).toContain("selected");
    expect(slider().value).toBe("10000");
  });

  it("moving the position into an episode selects it; leaving it keeps the last selection", async () => {
    await setup();
    fireEvent.change(slider(), { target: { value: "3000" } });
    expect(selection()).toEqual([true, true, false, false]);
    fireEvent.change(slider(), { target: { value: "7000" } });
    expect(selection()).toEqual([true, true, false, false]);
    expect(screen.getByText("00:07 / 00:20")).toBeTruthy();
    fireEvent.change(slider(), { target: { value: "12000" } });
    expect(selection()).toEqual([false, false, true, true]);
  });

  it("a click on the emotion chart seeks and selects the episode there", async () => {
    const user = await setup();
    const chart = screen.getByRole("img", { name: /^Доли негатива/ });
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 120, right: 1000, bottom: 120, x: 0, y: 0, toJSON: () => ({}) });
    await user.pointer({ keys: "[MouseLeft]", target: chart, coords: { clientX: 600, clientY: 60 } });
    expect(slider().value).toBe("12000");
    expect(selection()).toEqual([false, false, true, true]);
  });

  describe("with the recording", () => {
    it("selecting an episode seeks the video", async () => {
      const user = await setup("/media/f1");
      const video = document.querySelector("video")!;
      expect(video.getAttribute("src")).toBe("/media/f1");
      expect(video.currentTime).toBe(0);
      await user.click(tableEp("00:10–00:14"));
      expect(video.currentTime).toBe(10);
      await user.click(timelineEp(/^Инцидент/));
      expect(video.currentTime).toBe(2);
    });

    it("video playback time selects the episode and moves the slider", async () => {
      await setup("/media/f1");
      const video = document.querySelector("video")!;
      video.currentTime = 2.5;
      fireEvent.timeUpdate(video);
      expect(selection()).toEqual([true, true, false, false]);
      expect(slider().value).toBe("2500");
      video.currentTime = 13;
      fireEvent.timeUpdate(video);
      expect(selection()).toEqual([false, false, true, true]);
    });

    it("small position changes from playback do not seek the video back", async () => {
      await setup("/media/f1");
      const video = document.querySelector("video")!;
      const set = vi.fn();
      let t = 5;
      Object.defineProperty(video, "currentTime", { configurable: true, get: () => t, set });
      fireEvent.timeUpdate(video);
      t = 5.2;
      fireEvent.change(slider(), { target: { value: "5000" } });
      expect(set).not.toHaveBeenCalled(); // within 400 ms of the video's own time
      fireEvent.change(slider(), { target: { value: "11000" } });
      expect(set).toHaveBeenCalledWith(11);
    });
  });
});

describe("playback the browser cannot do (OQ1)", () => {
  it("shows the playback_unavailable note", async () => {
    fileMediaUrl.mockReturnValue("/media/f1");
    render(<Result file={{ ...FILE, notes: ["no_audio_track", "playback_unavailable"] }} />);
    await screen.findByRole("region", { name: "Эпизоды" });
    expect(screen.getByText("Нет аудиодорожки · Браузер не может воспроизвести этот формат")).toBeTruthy();
  });

  it("a video error shows the message once", async () => {
    await setup("/media/f1");
    expect(screen.queryByText("Браузер не может воспроизвести этот формат")).toBeNull();
    fireEvent.error(document.querySelector("video")!);
    expect(screen.getByText("Браузер не может воспроизвести этот формат")).toBeTruthy();
  });
});
