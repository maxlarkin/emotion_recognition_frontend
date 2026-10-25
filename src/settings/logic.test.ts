import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, DEFAULT_STREAM_SETTINGS, type AppSettings, type Stream } from "../api/types";
import { cameraSummary, changedFields } from "./CamerasTab";
import { bulkPatch, canApplyBulk, EMPTY_BULK, matchesCamera, sameSettings, validateSettings } from "./logic";

const clone = (): AppSettings => structuredClone(DEFAULT_SETTINGS);

describe("global settings", () => {
  it("accepts the defaults and rejects out-of-range values", () => {
    expect(validateSettings(clone())).toBeNull();
    const s = clone();
    s.events.negative_threshold = 0.95;
    expect(validateSettings(s)).toBe("Значение вне допустимого диапазона");
    const t = clone();
    t.events.negative_emotions = [];
    expect(validateSettings(t)).toBe("Выберите хотя бы одну негативную эмоцию");
  });

  it("detects unsaved changes, ignoring emotion order", () => {
    const a = clone();
    const b = clone();
    b.events.negative_emotions = [...b.events.negative_emotions].reverse();
    expect(sameSettings(a, b)).toBe(true);
    b.journal.interval_s = 30;
    expect(sameSettings(a, b)).toBe(false);
  });
});

describe("bulk camera edit", () => {
  it("sends only the chosen fields", () => {
    expect(bulkPatch({ ...EMPTY_BULK, analysis_fps: 3 })).toEqual({ settings: { analysis_fps: 3 } });
    expect(bulkPatch({ ...EMPTY_BULK, enabled: false, min_face_px: 56 })).toEqual({ settings: { enabled: false, min_face_px: 56 } });
    expect(bulkPatch({ ...EMPTY_BULK, camera_type: "security" })).toEqual({ camera_type: "security" });
    expect(bulkPatch(EMPTY_BULK)).toEqual({});
  });

  it("applies only with at least one field and one camera", () => {
    expect(canApplyBulk(EMPTY_BULK, 2)).toBe(false);
    expect(canApplyBulk({ ...EMPTY_BULK, analysis_fps: 8 }, 0)).toBe(false);
    expect(canApplyBulk({ ...EMPTY_BULK, analysis_fps: 8 }, 2)).toBe(true);
  });
});

describe("camera list", () => {
  const s: Stream = {
    id: "c",
    name: "Ресепшн",
    site: "Тверская",
    url: "rtsp://192.0.2.22/main",
    camera_type: "sector",
    settings: DEFAULT_STREAM_SETTINGS,
    state: "running",
    fps: 5,
    has_audio: true,
    source_resolution: null,
    session_id: null,
  };

  it("searches by name, site and address", () => {
    expect(matchesCamera(s, "ресеп")).toBe(true);
    expect(matchesCamera(s, "ТВЕР")).toBe(true);
    expect(matchesCamera(s, "192.0.2.22")).toBe(true);
    expect(matchesCamera(s, "склад")).toBe(false);
  });

  it("summarises a camera row", () => {
    expect(cameraSummary(s)).toBe("Секторная · 5 к/с");
    expect(cameraSummary({ ...s, settings: { ...s.settings, enabled: false } })).toBe("выключен");
  });
});

describe("camera save", () => {
  it("never sends an untouched (masked) url back, only changed fields", () => {
    const s: Stream = {
      id: "c", name: "Вход", site: "", url: "rtsp://***@192.0.2.1/main", camera_type: "security", settings: DEFAULT_STREAM_SETTINGS,
      state: "running", fps: 5, has_audio: false, source_resolution: null, session_id: null,
    };
    const draft = { name: "Вход 2", site: "", url: s.url, camera_type: s.camera_type, settings: { ...s.settings, analysis_fps: 3 as const } };
    expect(changedFields(s, draft)).toEqual({ name: "Вход 2", settings: { analysis_fps: 3 } });
  });
});
