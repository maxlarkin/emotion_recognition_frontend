// Demo data for the stub backend. Names, sites and addresses are placeholders, not real cameras.
import { DEFAULT_STREAM_SETTINGS, type CameraType, type FileStatus, type Health, type Stream, type StreamSettings } from "../types";

interface DemoStream {
  id: string;
  name: string;
  site: string;
  url: string;
  camera_type: CameraType;
  source_resolution: [number, number];
  has_audio: boolean;
  state: Stream["state"];
  settings?: Partial<StreamSettings>;
  /** Face width as a share of the frame width; drives face_px and the abstain share. */
  faceShare: number;
  tracks: number;
}

export const DEMO_STREAMS: DemoStream[] = [
  { id: "cam1", name: "Ресепшн", site: "Тверская", url: "rtsp://192.0.2.22:554/main", camera_type: "sector", source_resolution: [3840, 2160], has_audio: true, state: "running", faceShare: 0.06, tracks: 3 },
  { id: "cam2", name: "Вход", site: "Тверская", url: "rtsp://192.0.2.21:554/main", camera_type: "security", source_resolution: [2560, 1440], has_audio: false, state: "running", faceShare: 0.022, tracks: 2 },
  { id: "cam3", name: "Зона ожидания", site: "Тверская", url: "rtsp://192.0.2.15:554/main", camera_type: "security", source_resolution: [2560, 1440], has_audio: false, state: "running", faceShare: 0.016, tracks: 3, settings: { min_face_px: 56, analysis_fps: 3 } },
  { id: "cam4", name: "Касса", site: "Тверская", url: "rtsp://192.0.2.30:554/stream", camera_type: "webcam", source_resolution: [1280, 960], has_audio: true, state: "running", faceShare: 0.2, tracks: 1 },
  { id: "cam5", name: "Консультации", site: "Арбат", url: "rtsp://192.0.2.41:554/main", camera_type: "sector", source_resolution: [3840, 2160], has_audio: true, state: "running", faceShare: 0.05, tracks: 2 },
  { id: "cam6", name: "Кабинет менеджера", site: "Арбат", url: "rtsp://192.0.2.42:554/stream", camera_type: "webcam", source_resolution: [1280, 960], has_audio: true, state: "running", faceShare: 0.24, tracks: 1 },
  { id: "cam7", name: "Касса", site: "Ленинский", url: "rtsp://192.0.2.50:554/stream", camera_type: "webcam", source_resolution: [1280, 960], has_audio: true, state: "connecting", faceShare: 0.2, tracks: 1 },
  { id: "cam8", name: "Вход", site: "Ленинский", url: "rtsp://192.0.2.51:554/main", camera_type: "security", source_resolution: [2560, 1440], has_audio: false, state: "error", faceShare: 0.02, tracks: 0, settings: { enabled: true } },
];

export function demoStream(d: DemoStream): Stream {
  return {
    id: d.id,
    name: d.name,
    site: d.site,
    url: d.url,
    camera_type: d.camera_type,
    settings: { ...DEFAULT_STREAM_SETTINGS, ...d.settings },
    state: d.state,
    fps: 0,
    has_audio: d.has_audio,
    source_resolution: d.state === "running" ? d.source_resolution : null,
    decode: d.state === "running" ? "nvdec" : null,
    session_id: d.state === "running" ? `rtsp-${d.id}` : null,
  };
}

interface DemoFile {
  id: string;
  file_name: string;
  duration_s: number;
  resolution: [number, number];
  status: FileStatus;
  notes?: string[];
  error?: string;
}

export const DEMO_FILES: DemoFile[] = [
  { id: "file-1", file_name: "tverskaya_reception_2026-10-08.mp4", duration_s: 412, resolution: [1920, 1080], status: "done" },
  { id: "file-2", file_name: "arbat_consult_2026-10-09.mp4", duration_s: 245, resolution: [1280, 720], status: "processing" },
  { id: "file-3", file_name: "waiting_area_2026-10-09.mkv", duration_s: 380, resolution: [2560, 1440], status: "queued" },
  { id: "file-4", file_name: "entrance_no_audio_2026-10-07.mp4", duration_s: 96, resolution: [1280, 720], status: "done", notes: ["no_audio_track"] },
  { id: "file-5", file_name: "broken_export_2026-10-06.avi", duration_s: 0, resolution: [1280, 720], status: "failed", error: "Не удалось прочитать видеопоток" },
];

/** Earlier webcam sessions: id, how long ago it started (s) and its duration (s). */
export const DEMO_LIVE_SESSIONS = [
  { id: "live-demo-1", ago_s: 5400, duration_s: 312 },
  { id: "live-demo-2", ago_s: 87_600, duration_s: 95 },
];

export const DEMO_HEALTH: Health = {
  status: "ok",
  device: "cuda",
  models: { yunet: true, fer: true, vad: true, ser: true },
  gpu_name: "NVIDIA GeForce RTX 3050 Laptop GPU",
};
