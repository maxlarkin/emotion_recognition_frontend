// Shapes from interfaces.md. Mocks and real calls return exactly these.
import type { AudioBlock, Emotion, FaceResult, Probs } from "../live/protocol";

export type { AudioBlock, Emotion, FaceResult, Probs };

export type ModelKey = "yunet" | "fer" | "vad" | "ser";

export interface Health {
  status: "ok" | "degraded";
  device: "cpu" | "cuda";
  models: Record<ModelKey, boolean>;
  gpu_name?: string;
  warning?: string;
}

export type Decision = "alert" | "watch" | "abstain" | "positive" | "none";
export type CameraType = "webcam" | "sector" | "security";
export type StreamState = "connecting" | "running" | "reconnecting" | "stopped" | "error";

export const ANALYSIS_FPS = [3, 5, 8] as const;
export const DETECTION_SIZES = ["auto", 640, 1280, 1920, 2560] as const;
export const MIN_FACE_PX = [40, 48, 56, 64] as const;

export interface StreamSettings {
  enabled: boolean;
  analysis_fps: (typeof ANALYSIS_FPS)[number];
  detection_size: (typeof DETECTION_SIZES)[number];
  min_face_px: (typeof MIN_FACE_PX)[number];
}

export const DEFAULT_STREAM_SETTINGS: StreamSettings = { enabled: true, analysis_fps: 5, detection_size: "auto", min_face_px: 48 };

export interface Stream {
  id: string;
  name: string;
  site: string;
  url: string; // credentials masked by the server
  camera_type: CameraType;
  settings: StreamSettings;
  state: StreamState;
  fps: number;
  has_audio: boolean;
  source_resolution: [number, number] | null;
  decode?: "nvdec" | "cpu" | null; // decode mode of the last open (GPU image tries NVDEC)
  session_id: string | null;
}

export interface NewStream {
  name: string;
  site: string;
  url: string;
  camera_type: CameraType;
  settings?: Partial<StreamSettings>;
}

export type StreamPatch = Partial<Pick<Stream, "name" | "site" | "url" | "camera_type">> & {
  settings?: Partial<StreamSettings>;
};

export type StreamTestResult =
  | { ok: true; resolution: [number, number]; has_audio: boolean }
  | { ok: false; error: string };

/** Face object with the event engine's decision (/ws/streams, session timelines; /ws/live sends the same fields). */
export interface StreamFace extends FaceResult {
  decision: Decision;
  face_px: number;
}

export interface StreamResult {
  type: "stream_result";
  stream_id: string;
  frame_id: number;
  decode_ts: number;
  emit_ts: number;
  faces: StreamFace[];
  audio: AudioBlock | null;
  fps: number;
}

export interface StreamStatusMessage {
  type: "stream_status";
  stream_id: string;
  state: StreamState;
  message?: string;
}

export interface SystemLoad {
  server_ts: number;
  cpu_pct: number;
  ram_used_mb: number;
  ram_total_mb: number;
  gpu_util_pct: number | null;
  vram_used_mb: number | null;
  vram_total_mb: number | null;
}

export type IncidentState = "new" | "confirmed" | "false_alarm";

export interface EmotionEvent {
  event_id: string;
  kind: "negative" | "positive";
  session_id: string;
  stream_id: string | null;
  camera_type: CameraType | null;
  track_id: number;
  start_ts: number;
  emit_ts: number;
  duration_ms: number;
  emotion: Emotion;
  group_prob: number;
  state: IncidentState | null;
}

export interface EventFilters {
  kind?: "negative" | "positive";
  state?: IncidentState;
  stream_id?: string;
  session_id?: string;
  from_ms?: number;
  to_ms?: number;
  limit?: number;
  before_id?: string;
}

export type StreamsMessage =
  | StreamResult
  | StreamStatusMessage
  | { type: "event"; event: EmotionEvent }
  | ({ type: "system" } & SystemLoad);

export type NegativeEmotion = "anger" | "disgust" | "fear" | "sadness";
export const NEGATIVE_EMOTIONS: readonly NegativeEmotion[] = ["anger", "sadness", "fear", "disgust"];
export const JOURNAL_INTERVALS = [5, 10, 30, 60] as const;

export interface AppSettings {
  events: {
    negative_emotions: NegativeEmotion[];
    negative_threshold: number;
    positive_threshold: number;
    min_duration_s: number;
    cooldown_s: number;
  };
  journal: { interval_s: (typeof JOURNAL_INTERVALS)[number] };
}

export const DEFAULT_SETTINGS: AppSettings = {
  events: {
    negative_emotions: ["anger", "disgust", "fear", "sadness"],
    negative_threshold: 0.6,
    positive_threshold: 0.6,
    min_duration_s: 2,
    cooldown_s: 30,
  },
  journal: { interval_s: 10 },
};

export interface StreamLogRow {
  from_ts: number;
  to_ts: number;
  clients: number;
  dominant_emotion: Emotion;
  negative_prob: number;
  decision: Decision;
}

export type SessionKind = "live" | "file" | "rtsp";

/** One row of GET /api/sessions. `created_at` is server epoch ms, `duration` is in seconds. */
export interface SessionInfo {
  id: string;
  kind: SessionKind;
  stream_id: string | null;
  created_at: number;
  duration: number;
  status: string;
  file_name?: string;
  progress?: number | null;
}

export type FileStatus = "queued" | "processing" | "done" | "failed";

export interface FileSession {
  id: string;
  file_name: string;
  created_at: number;
  status: FileStatus;
  progress: number | null; // 0–1
  duration_ms: number | null;
  resolution: [number, number] | null;
  notes: string[]; // no_audio_track, no_faces_detected
  error: string | null;
  usable_pct: number | null;
}

/** GET /api/sessions/{id}/timeline (interfaces.md, Session timeline). */
export interface Timeline {
  session_id?: string;
  kind?: SessionKind;
  duration_ms?: number;
  frames: { ts_ms: number; width: number; height: number; faces: StreamFace[] }[];
  audio: (AudioBlock & { window_end_ts: number })[];
}

export type ExportFormat = "csv" | "json";
