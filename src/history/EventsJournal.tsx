// `/history/events` (CAP-11): filters, live-appended events, incident ack, export, «Показать ещё».
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api, type EmotionEvent, type EventFilters, type ExportFormat, type IncidentState, type Stream } from "../api";
import { appData, useStreams } from "../state/appData";
import { download, DropdownButton, Segmented } from "../ui/controls";
import { cameraName, EMOTION_LABEL, eventTime, INCIDENT_LABEL, minSec, prob, siteLabel } from "../ui/format";

const PAGE = 50;

const KIND_OPTIONS = [
  { value: "all", label: "Все" },
  { value: "negative", label: "Негатив" },
  { value: "positive", label: "Позитив" },
] as const;
const STATE_OPTIONS = [
  { value: "all", label: "Все" },
  { value: "new", label: "Новые" },
  { value: "confirmed", label: "Подтверждённые" },
  { value: "false_alarm", label: "Ложные" },
] as const;

/** URL search params → API filters (empty values dropped). */
export function filtersFromParams(p: URLSearchParams): EventFilters {
  const f: EventFilters = {};
  const kind = p.get("kind");
  if (kind === "negative" || kind === "positive") f.kind = kind;
  const state = p.get("state");
  if (state === "new" || state === "confirmed" || state === "false_alarm") f.state = state;
  const cam = p.get("stream");
  if (cam) f.stream_id = cam;
  const from = Number(p.get("from"));
  if (p.get("from") && Number.isFinite(from)) f.from_ms = from;
  const to = Number(p.get("to"));
  if (p.get("to") && Number.isFinite(to)) f.to_ms = to;
  return f;
}

/** Whether a live event belongs in the current filtered list. */
export function eventMatches(e: EmotionEvent, f: EventFilters): boolean {
  return (
    (!f.kind || e.kind === f.kind) &&
    (!f.state || e.state === f.state) &&
    (!f.stream_id || e.stream_id === f.stream_id) &&
    (f.from_ms === undefined || e.emit_ts >= f.from_ms) &&
    (f.to_ms === undefined || e.emit_ts <= f.to_ms)
  );
}

/** Inserts or replaces a live event in a newest-first list, dropping it if it no longer matches. */
export function mergeEvent(list: readonly EmotionEvent[], e: EmotionEvent, f: EventFilters): EmotionEvent[] {
  const rest = list.filter((x) => x.event_id !== e.event_id);
  if (!eventMatches(e, f)) return rest;
  const i = rest.findIndex((x) => x.emit_ts < e.emit_ts);
  return i < 0 ? [...rest, e] : [...rest.slice(0, i), e, ...rest.slice(i)];
}

export function toLocalInput(ms: number | undefined): string {
  if (ms === undefined) return "";
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 16) : "";
}

/** datetime-local has minute precision: «по 14:05» includes the whole 14:05 minute. */
export const endOfMinute = (value: string): string => String(new Date(value).getTime() + 59_999);

export default function EventsJournal() {
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params);
  const key = params.toString();
  const { streams } = useStreams();
  const [events, setEvents] = useState<EmotionEvent[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
  const [files, setFiles] = useState<Map<string, string>>(new Map());
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    api.listFileSessions().then((l) => setFiles(new Map(l.map((f) => [f.id, f.file_name] as const))), () => {});
  }, []);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v === null || v === "" || v === "all") next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: true });
  };

  const load = useCallback(async (before?: EmotionEvent) => {
    const f = filtersFromParams(new URLSearchParams(key));
    try {
      const page = await api.listEvents({ ...f, limit: PAGE, before_id: before?.event_id });
      if (keyRef.current !== key) return; // filters changed while loading
      setEvents((prev) => (before && prev ? [...prev, ...page.filter((e) => !prev.some((x) => x.event_id === e.event_id))] : page));
      setMore(page.length === PAGE);
      setError(null);
    } catch (e) {
      if (keyRef.current === key) setError(e instanceof Error ? e.message : String(e));
    }
  }, [key]);

  const loadMore = async () => {
    if (!events?.length || loadingMore) return;
    setLoadingMore(true);
    await load(events[events.length - 1]);
    setLoadingMore(false);
  };

  useEffect(() => {
    setEvents(null);
    void load();
  }, [load]);

  useEffect(() => {
    const f = filtersFromParams(new URLSearchParams(key));
    return appData.onEvent((e) => setEvents((prev) => (prev ? mergeEvent(prev, e, f) : prev)));
  }, [key]);

  const ack = async (e: EmotionEvent, state: "confirmed" | "false_alarm") => {
    setBusy(e.event_id);
    try {
      await appData.ack(e.event_id, state);
      setAckError(null);
    } catch (err) {
      setAckError(`Не удалось сохранить состояние инцидента: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const exportAs = (format: ExportFormat) => {
    const { url, filename } = api.exportEvents(filters, format);
    download(url, filename);
  };

  return (
    <main className="content page">
      <div className="page-head">
        <h1>Журнал событий</h1>
        <div className="actions">
          <DropdownButton
            label="Экспорт"
            items={[
              { label: "Таблица CSV", onSelect: () => exportAs("csv") },
              { label: "JSON", onSelect: () => exportAs("json") },
            ]}
          />
        </div>
      </div>
      <section className="panel filters" aria-label="Фильтры">
        <div className="filter">
          <span className="caption secondary-text">Тип</span>
          <Segmented label="Тип" options={KIND_OPTIONS} value={filters.kind ?? "all"} onChange={(v) => setParam("kind", v)} />
        </div>
        <div className="filter">
          <span className="caption secondary-text">Состояние</span>
          <Segmented label="Состояние" options={STATE_OPTIONS} value={filters.state ?? "all"} onChange={(v) => setParam("state", v)} />
        </div>
        <label className="filter">
          <span className="caption secondary-text">Камера</span>
          <select className="input" value={filters.stream_id ?? ""} onChange={(e) => setParam("stream", e.target.value)}>
            <option value="">Все камеры</option>
            {(streams ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {siteLabel(s.site)} · {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span className="caption secondary-text">С</span>
          <input className="input" type="datetime-local" value={toLocalInput(filters.from_ms)} onChange={(e) => setParam("from", e.target.value ? String(new Date(e.target.value).getTime()) : null)} />
        </label>
        <label className="filter">
          <span className="caption secondary-text">По</span>
          <input className="input" type="datetime-local" value={toLocalInput(filters.to_ms)} onChange={(e) => setParam("to", e.target.value ? endOfMinute(e.target.value) : null)} />
        </label>
      </section>
      <section className="panel">
        {error && <p className="error-text">Не удалось загрузить журнал ({error})</p>}
        {ackError && (
          <p className="error-text" role="alert">
            {ackError}
          </p>
        )}
        {!events && !error && <p className="empty-note">Загрузка…</p>}
        {events && events.length === 0 && <p className="empty-note">Событий нет</p>}
        {events && events.length > 0 && <EventsTable events={events} streams={streams} files={files} busy={busy} onAck={ack} />}
        {more && (
          <button type="button" className="btn btn-sm more" disabled={loadingMore} onClick={loadMore}>
            Показать ещё
          </button>
        )}
      </section>
    </main>
  );
}

export function EventsTable({
  events,
  streams,
  files,
  busy = null,
  onAck,
  timeZone,
}: {
  events: readonly EmotionEvent[];
  streams: readonly Stream[] | null;
  files?: ReadonlyMap<string, string>;
  busy?: string | null;
  onAck: (e: EmotionEvent, s: "confirmed" | "false_alarm") => void;
  timeZone?: string;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Время</th>
            <th scope="col">Камера</th>
            <th scope="col">Клиент</th>
            <th scope="col">Эмоция</th>
            <th scope="col" className="num">
              Уверенность
            </th>
            <th scope="col" className="num">
              Длительность
            </th>
            <th scope="col">Состояние</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.event_id} className={e.kind === "negative" ? "negative" : undefined}>
              <td className="time">{eventTime(e.emit_ts, timeZone)}</td>
              <td>{cameraName(e, streams, files)}</td>
              <td className="mono">#{e.track_id}</td>
              <td>
                <span className={e.kind === "negative" ? "chip chip-watch" : "chip chip-positive"}>{EMOTION_LABEL[e.emotion]}</span>
              </td>
              <td className="num">{prob(e.group_prob)}</td>
              <td className="num">{minSec(e.duration_ms / 1000)}</td>
              <td>
                <IncidentCell event={e} busy={busy === e.event_id} onAck={onAck} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IncidentCell({ event, busy, onAck }: { event: EmotionEvent; busy: boolean; onAck: (e: EmotionEvent, s: "confirmed" | "false_alarm") => void }) {
  if (event.kind === "positive") return <span className="muted small">Записано</span>;
  if (event.state !== "new") return <span className="small">{INCIDENT_LABEL[(event.state ?? "new") as IncidentState]}</span>;
  return (
    <span className="row-actions">
      <span className="chip chip-alert">Новое</span>
      <button type="button" className="btn btn-sm btn-alert" disabled={busy} onClick={() => onAck(event, "confirmed")}>
        Подтвердить
      </button>
      <button type="button" className="btn btn-sm btn-alert-outline" disabled={busy} onClick={() => onAck(event, "false_alarm")}>
        Ложное
      </button>
    </span>
  );
}
