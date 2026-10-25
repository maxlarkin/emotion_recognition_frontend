/** Pure text helpers for the «Сессии» card. */

const KIND_LABELS: Record<string, string> = {
  live: "Веб-камера",
  file: "Файл",
  rtsp: "Камера (RTSP)",
};

const STATUS_LABELS: Record<string, string> = {
  running: "идёт",
  finished: "завершена",
  queued: "в очереди",
  processing: "обрабатывается",
  done: "готово",
  failed: "ошибка",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Seconds -> «45 с», «2 мин 05 с», «1 ч 02 мин». */
export function durationText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds);
  if (s < 60) return `${s} с`;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (s < 3600) return `${Math.floor(s / 60)} мин ${pad(s % 60)} с`;
  return `${Math.floor(s / 3600)} ч ${pad(Math.floor((s % 3600) / 60))} мин`;
}

/** Epoch ms -> «08.10.2026, 14:03:07» in the browser's time zone. */
export function dateText(epochMs: number, timeZone?: string): string {
  if (!Number.isFinite(epochMs)) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  }).format(new Date(epochMs));
}
