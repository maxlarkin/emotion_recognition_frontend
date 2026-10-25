import { useCallback, useEffect, useRef, useState } from "react";
import { deleteSession, exportUrl, fetchSessions, type SessionInfo } from "../api";
import { dateText, durationText, kindLabel, statusLabel } from "./format";

const RUNNING_POLL_MS = 5000; // while a session runs, its duration and status change
/** Statuses of a session that is still going: live/RTSP `running`, file `queued`/`processing`. */
const RUNNING_STATUSES = ["running", "queued", "processing"];
export const isRunning = (status: string): boolean => RUNNING_STATUSES.includes(status);

/** Sessions list: loads when opened and polls while a session runs. */
export default function SessionsView() {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // id being deleted
  const ctrlRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    try {
      const list = await fetchSessions(ctrl.signal);
      if (ctrl.signal.aborted) return;
      setSessions(list);
      setError(null);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
    return () => ctrlRef.current?.abort();
  }, [load]);

  const anyRunning = sessions?.some((s) => isRunning(s.status)) ?? false;
  useEffect(() => {
    if (!anyRunning) return;
    const timer = window.setInterval(load, RUNNING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [anyRunning, load]);

  const remove = async (id: string) => {
    if (!window.confirm("Удалить сессию? Данные будут удалены без возможности восстановления.")) return;
    setBusy(id);
    try {
      await deleteSession(id);
      setError(null);
    } catch (e) {
      setError(`Не удалось удалить сессию: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      load();
    }
  };

  return (
    <>
      <div className="page-head">
        <h1 id="sessions-title">Сеансы и экспорт</h1>
        <div className="actions">
          <button type="button" className="btn btn-sm" onClick={load}>
            Обновить
          </button>
        </div>
      </div>
      <section className="panel sessions" aria-labelledby="sessions-title">
      {error && <p className="error-text">{sessions ? error : `Не удалось загрузить список сессий (${error}).`}</p>}
      {!error && !sessions && <p className="empty-note">Загрузка…</p>}
      {sessions && <SessionsTable sessions={sessions} busy={busy} onDelete={remove} />}
      </section>
    </>
  );
}

export function SessionsTable({
  sessions,
  busy = null,
  onDelete,
}: {
  sessions: SessionInfo[];
  busy?: string | null;
  onDelete: (id: string) => void;
}) {
  if (sessions.length === 0) return <p className="empty-note">Сессий пока нет</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Начало</th>
            <th scope="col">Тип</th>
            <th scope="col">Длительность</th>
            <th scope="col">Статус</th>
            <th scope="col">
              <span className="sr-only">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const running = isRunning(s.status);
            return (
              <tr key={s.id}>
                <td className="time">{dateText(s.created_at)}</td>
                <td>{kindLabel(s.kind)}</td>
                <td className="num">{durationText(s.duration)}</td>
                <td className={running ? "text-live" : undefined}>{statusLabel(s.status)}</td>
                <td className="row-actions">
                  <a href={exportUrl(s.id, "csv")} download={`session-${s.id}.csv`}>
                    CSV
                  </a>
                  <a href={exportUrl(s.id, "json")} download={`session-${s.id}.json`}>
                    JSON
                  </a>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onDelete(s.id)}
                    disabled={running || busy === s.id}
                    title={running ? "Сессия ещё идёт" : "Удалить сессию"}
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
