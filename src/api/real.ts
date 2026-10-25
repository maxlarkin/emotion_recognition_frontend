// Backend REST calls (interfaces.md). Errors carry the server's Russian `detail`.
import type {
  AppSettings,
  EmotionEvent,
  EventFilters,
  ExportFormat,
  FileSession,
  Health,
  NewStream,
  SessionInfo,
  Stream,
  StreamLogRow,
  StreamPatch,
  StreamTestResult,
  SystemLoad,
  Timeline,
} from "./types";

const HEALTH_TIMEOUT_MS = 4000;
const DEFAULT_TIMEOUT_MS = 8000;

async function errorText(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    const detail = (body as { detail?: unknown } | null)?.detail;
    if (typeof detail === "string") return detail;
  } catch {
    // not JSON
  }
  return `HTTP ${res.status}`;
}

function withTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** GET a JSON body; aborted by `signal` or after `timeoutMs`. Errors carry the server's `detail`. */
async function getJson(url: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal: withTimeout(timeoutMs, signal), cache: "no-store" });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

async function sendJson(method: string, url: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.status === 204 ? null : res.json();
}

function query(params: object): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

const enc = encodeURIComponent;

export async function fetchHealth(signal?: AbortSignal): Promise<Health> {
  const body = await getJson("/api/health", HEALTH_TIMEOUT_MS, signal);
  const models = (body as { models?: unknown } | null)?.models;
  if (typeof models !== "object" || models === null || Array.isArray(models)) {
    throw new Error("некорректный ответ сервера");
  }
  return body as Health;
}

export async function fetchSessions(signal?: AbortSignal): Promise<SessionInfo[]> {
  const body = await getJson("/api/sessions", DEFAULT_TIMEOUT_MS, signal);
  if (!Array.isArray(body) || !body.every((s) => typeof s?.id === "string" && typeof s?.created_at === "number")) {
    throw new Error("некорректный ответ сервера");
  }
  return body as SessionInfo[];
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${enc(id)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(await errorText(res));
}

export function exportUrl(id: string, format: ExportFormat): string {
  return `/api/sessions/${enc(id)}/export?format=${format}`;
}

// --- Streams (story 1.7) ---

export const listStreams = (signal?: AbortSignal) =>
  getJson("/api/streams", DEFAULT_TIMEOUT_MS, signal) as Promise<Stream[]>;

export async function createStream(body: NewStream): Promise<Stream> {
  const { id } = (await sendJson("POST", "/api/streams", body)) as { id: string };
  const all = await listStreams();
  const created = all.find((s) => s.id === id);
  if (!created) throw new Error("некорректный ответ сервера");
  return created;
}

export const updateStream = (id: string, patch: StreamPatch) =>
  sendJson("PATCH", `/api/streams/${enc(id)}`, patch) as Promise<Stream>;
export const deleteStream = async (id: string) => void (await sendJson("DELETE", `/api/streams/${enc(id)}`));
export const reconnectStream = async (id: string) => void (await sendJson("POST", `/api/streams/${enc(id)}/reconnect`));
export const testStream = (url: string) => sendJson("POST", "/api/streams/test", { url }) as Promise<StreamTestResult>;
export const fetchStreamLog = (id: string, intervalS: number, limit = 50) =>
  getJson(`/api/streams/${enc(id)}/log${query({ interval_s: intervalS, limit })}`, DEFAULT_TIMEOUT_MS) as Promise<StreamLogRow[]>;
export const fetchSystem = (signal?: AbortSignal) => getJson("/api/system", DEFAULT_TIMEOUT_MS, signal) as Promise<SystemLoad>;

// --- Events and settings (story 1.11) ---

export const listEvents = (f: EventFilters, signal?: AbortSignal) =>
  getJson(`/api/events${query(f)}`, DEFAULT_TIMEOUT_MS, signal) as Promise<EmotionEvent[]>;
export const ackEvent = (id: string, state: "confirmed" | "false_alarm") =>
  sendJson("POST", `/api/events/${enc(id)}/ack`, { state }) as Promise<EmotionEvent>;
/** Download link of the filtered journal (paging fields dropped: the export has every match). */
export function exportEvents(f: EventFilters, format: ExportFormat): { url: string; filename: string } {
  const { limit: _limit, before_id: _before, ...filters } = f;
  return { url: `/api/events/export${query({ ...filters, format })}`, filename: `events.${format}` };
}
export const fetchSettings = () => getJson("/api/settings", DEFAULT_TIMEOUT_MS) as Promise<AppSettings>;
export const saveSettings = (s: AppSettings) => sendJson("PUT", "/api/settings", s) as Promise<AppSettings>;

// --- File analysis (story 1.12) ---

type RawFileSession = Omit<SessionInfo, "status"> & Partial<Omit<FileSession, "status">> & { status: string };

const FILE_STATUSES: readonly string[] = ["queued", "processing", "done", "failed"] satisfies FileSession["status"][];

export function toFileSession(s: RawFileSession): FileSession {
  const known = FILE_STATUSES.includes(s.status);
  return {
    id: s.id,
    file_name: s.file_name ?? s.id,
    created_at: s.created_at,
    // an unknown status (a newer backend) is shown as an error rather than as a job that never ends
    status: known ? (s.status as FileSession["status"]) : "failed",
    progress: s.progress ?? null,
    duration_ms: s.duration_ms ?? (s.duration ? s.duration * 1000 : null),
    resolution: s.resolution ?? null,
    notes: s.notes ?? [],
    error: s.error ?? (known ? null : `Неизвестное состояние: ${s.status}`),
    usable_pct: s.usable_pct ?? null,
  };
}

export async function listFileSessions(signal?: AbortSignal): Promise<FileSession[]> {
  const list = await getJson("/api/sessions?kind=file", DEFAULT_TIMEOUT_MS, signal);
  if (!Array.isArray(list)) throw new Error("некорректный ответ сервера");
  return (list as RawFileSession[]).filter((s) => s.kind === "file").map(toFileSession);
}

export async function fetchFileSession(id: string): Promise<FileSession> {
  const body = (await getJson(`/api/sessions/${enc(id)}`, DEFAULT_TIMEOUT_MS)) as RawFileSession & { summary?: { usable_pct?: number | null } };
  return toFileSession({ ...body, usable_pct: body.summary?.usable_pct ?? null });
}

/** Upload progress: share of bytes sent, 0–1. */
export type UploadProgress = (sent: number) => void;

/** Multipart POST /api/files through XHR (fetch cannot report upload progress). */
export function postFile(file: File, onProgress?: UploadProgress): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.responseType = "text";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const id = (body as { session_id?: unknown } | null)?.session_id;
        if (typeof id === "string") resolve(id);
        else reject(new Error("некорректный ответ сервера"));
        return;
      }
      const detail = (body as { detail?: unknown } | null)?.detail;
      // nginx answers an over-limit body with an HTML 413 (client_max_body_size 2g)
      const fallback = xhr.status === 413 ? "Файл больше 2 ГБ" : `HTTP ${xhr.status}`;
      reject(new Error(typeof detail === "string" ? detail : fallback));
    };
    xhr.onerror = () => reject(new Error("нет связи с сервером"));
    xhr.onabort = () => reject(new Error("загрузка прервана"));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export async function uploadFile(file: File, onProgress?: UploadProgress): Promise<FileSession> {
  const sessionId = await postFile(file, onProgress);
  return fetchFileSession(sessionId);
}

export const fetchTimeline = (id: string) => getJson(`/api/sessions/${enc(id)}/timeline`, 30000) as Promise<Timeline>;
export const mediaUrl = (id: string): string => `/api/sessions/${enc(id)}/media`;
