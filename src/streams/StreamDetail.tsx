// `/streams/:id` (mockup Main): incident banner, tiles, video + visitors, interval journal, processing block.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, DEFAULT_SETTINGS, type AudioBlock, type EmotionEvent, type Stream, type StreamFace, type StreamLogRow } from "../api";
import { appData, streamNow, useFeedVersion, useIncidents, useStreams } from "../state/appData";
import { useShell } from "../shell/context";
import { DecisionChip, Disclosure, StatusBadge, Tile } from "../ui/controls";
import {
  CAMERA_TYPE_DETECTION,
  CAMERA_TYPE_LABEL,
  DECISION_LABEL,
  EMOTION_LABEL,
  fps,
  intervalText,
  minSec,
  negativeProb,
  percent,
  prob,
  resolution,
  siteLabel,
  statusGroup,
  streamVoice,
} from "../ui/format";
import { AlertIcon, CameraOffIcon } from "../ui/icons";
import FrameView from "./FrameView";

export default function StreamDetail() {
  const { id = "" } = useParams();
  const { streams } = useStreams();
  if (!streams) return <main className="content"><p className="empty-note">Загрузка…</p></main>;
  const stream = streams.find((s) => s.id === id);
  if (!stream)
    return (
      <main className="content">
        <p>Поток не найден.</p>
        <Link to="/streams">Ко всем потокам</Link>
      </main>
    );
  return <Detail stream={stream} key={stream.id} />;
}

function Detail({ stream }: { stream: Stream }) {
  useFeedVersion();
  const incidents = useIncidents();
  const [intervalS, setIntervalS] = useState<number>(DEFAULT_SETTINGS.journal.interval_s);
  useEffect(() => {
    api.fetchSettings().then((s) => setIntervalS(s.journal.interval_s), () => {});
  }, []);

  const { feed, live, result, faces, decision } = streamNow(stream);
  const incident = incidents.find((e) => e.stream_id === stream.id && !appData.hidden.has(e.event_id));
  const hasIncident = incidents.some((e) => e.stream_id === stream.id);
  const stats = feed.stats;
  const minFace = stream.settings.min_face_px;
  const detSize = stream.settings.detection_size === "auto" ? CAMERA_TYPE_DETECTION[stream.camera_type] : stream.settings.detection_size;

  return (
    <main className="content">
      {incident && <IncidentBanner incident={incident} />}
      <div className="page-head">
        <h1>{stream.name}</h1>
        <StatusBadge state={stream.state} />
        <span className="muted">{siteLabel(stream.site)}</span>
      </div>
      <div className="tiles">
        <Tile label="Клиентов" value={live ? String(faces.length) : "—"} />
        <Tile label="Статус" value={!live ? "—" : hasIncident ? DECISION_LABEL.alert : DECISION_LABEL[decision ?? "none"]} alert={live && (decision === "alert" || hasIncident)} />
        <Tile label="Пригодных кадров" value={live ? percent(stats.usablePct) : "—"} />
      </div>
      <div className="video-row">
        <section aria-label="Видеопоток" className="video-box">
          {live ? (
            <FrameView frameUrl={feed.frameUrl} faces={faces} sourceResolution={stream.source_resolution}>
              <span className="live-badge">
                <span className="dot live-dot" />
                LIVE
              </span>
              <span className="video-stats mono">
                {result ? `${fps(result.fps)} · ` : ""}p50 {stats.p50 === null ? "—" : Math.round(stats.p50)} / p95{" "}
                {stats.p95 === null ? "—" : Math.round(stats.p95)} мс
              </span>
            </FrameView>
          ) : (
            <NoSignal stream={stream} />
          )}
        </section>
        <Visitors stream={stream} faces={faces} live={live} audio={result?.audio ?? null} />
      </div>
      <StreamJournal stream={stream} intervalS={intervalS} />
      <Disclosure title="Камера и обработка">
        <dl className="proc-grid">
          <ProcItem k="Источник" v={resolution(stream.source_resolution)} />
          <ProcItem k="Тип камеры" v={CAMERA_TYPE_LABEL[stream.camera_type]} />
          <ProcItem k="Поиск лиц" v={`${detSize} px${stream.settings.detection_size === "auto" ? " (авто)" : ""}`} />
          <ProcItem k="Частота анализа" v={`${stream.settings.analysis_fps} к/с`} />
          <ProcItem k="Медиана лица" v={live && stats.medianFacePx !== null ? `${Math.round(stats.medianFacePx)} px` : "—"} />
          <ProcItem k="Пригодных кадров" v={live ? percent(stats.usablePct) : "—"} />
          <ProcItem k="Задержка p95" v={live && stats.p95 !== null ? `${Math.round(stats.p95)} мс` : "—"} />
          <ProcItem k="Интервал журнала" v={`${intervalS} с`} />
        </dl>
        {live && smallFaces(stats.medianFacePx, minFace) && (
          <div className="warn-box">Лица мельче {minFace} px: точность снижается. Камеру лучше разместить ближе к зоне обслуживания.</div>
        )}
        <Link to={`/settings/cameras?camera=${encodeURIComponent(stream.id)}`} className="small">
          Настройки камеры
        </Link>
      </Disclosure>
    </main>
  );
}

function ProcItem({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd className="mono">{v}</dd>
    </div>
  );
}

/** Small-face warning: median face_px below the stream's minimum (ui.md Stream detail). */
export const smallFaces = (medianFacePx: number | null, minFacePx: number): boolean => medianFacePx !== null && medianFacePx < minFacePx;

export function incidentTitle(e: Pick<EmotionEvent, "track_id" | "group_prob" | "duration_ms">): string {
  return `Клиент #${e.track_id} · негатив ${prob(e.group_prob)} · ${minSec(e.duration_ms / 1000)}`;
}

function IncidentBanner({ incident }: { incident: EmotionEvent }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ack = async (state: "confirmed" | "false_alarm") => {
    setBusy(true);
    try {
      await appData.ack(incident.event_id, state);
    } catch (e) {
      setError(`не сохранено: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="incident-banner" role="alert">
      <AlertIcon />
      <span className="incident-title">{incidentTitle(incident)}</span>
      {error && <span className="error-text incident-error">{error}</span>}
      <div className="incident-actions">
        <button type="button" className="btn btn-sm btn-alert" disabled={busy} onClick={() => ack("confirmed")}>
          Подтвердить
        </button>
        <button type="button" className="btn btn-sm btn-alert-outline" disabled={busy} onClick={() => ack("false_alarm")}>
          Ложное
        </button>
        <button type="button" className="btn btn-sm btn-alert-outline" onClick={() => appData.hide(incident.event_id)}>
          Скрыть
        </button>
      </div>
    </div>
  );
}

function NoSignal({ stream }: { stream: Stream }) {
  const { toast } = useShell();
  const connecting = statusGroup(stream.state) === "connecting";
  const reconnect = async () => {
    try {
      await api.reconnectStream(stream.id);
    } catch (e) {
      toast(`Не удалось переподключить: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  };
  return (
    <div className="frame no-signal">
      <CameraOffIcon />
      <span className="no-signal-title">{stream.state === "stopped" ? "Анализ выключен" : connecting ? "Подключение…" : "Поток недоступен"}</span>
      {!connecting && stream.state !== "stopped" && (
        <button type="button" className="btn" onClick={reconnect}>
          Переподключить
        </button>
      )}
    </div>
  );
}

function Visitors({ stream, faces, live, audio }: { stream: Stream; faces: readonly StreamFace[]; live: boolean; audio: AudioBlock | null }) {
  return (
    <section aria-label="Посетители" className="panel visitors">
      <h3>Посетители</h3>
      {faces.map((f) => (
        <div className="visitor" key={f.track_id}>
          <div className="visitor-head">
            <span className="visitor-name">Клиент #{f.track_id}</span>
            <DecisionChip decision={f.decision} />
          </div>
          <div className="visitor-bar">
            <div className="bar">
              <span className={`bar-fill bar-${f.decision}`} style={{ width: `${Math.round(negativeProb(f.fused) * 100)}%` }} />
            </div>
            <span className="mono caption secondary-text">{f.decision === "abstain" ? "?" : prob(negativeProb(f.fused))}</span>
          </div>
          <span className="caption muted">
            Лицо: {EMOTION_LABEL[f.face_label]} · Итог: {EMOTION_LABEL[f.fused_label]} · {minSec(appData.trackAge(stream.id, f.track_id))}
          </span>
        </div>
      ))}
      {faces.length === 0 && <span className="empty-note">Нет данных</span>}
      {live && <span className="voice-line small">Голос: {streamVoice(stream.has_audio, audio)}</span>}
    </section>
  );
}

function StreamJournal({ stream, intervalS }: { stream: Stream; intervalS: number }) {
  const [rows, setRows] = useState<StreamLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = stream.state === "running";
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.fetchStreamLog(stream.id, intervalS).then(
        (r) => alive && (setRows(r), setError(null)),
        (e) => alive && setError(e instanceof Error ? e.message : String(e)),
      );
    load();
    const t = window.setInterval(load, intervalS * 1000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [stream.id, intervalS, running]);
  return (
    <section aria-label="Журнал" className="panel">
      <div className="panel-head">
        <h3>Журнал</h3>
      </div>
      {error && <p className="error-text">Не удалось загрузить журнал ({error})</p>}
      {rows && rows.length > 0 && <JournalTable rows={rows} />}
      {rows && rows.length === 0 && <span className="empty-note">Записей нет</span>}
    </section>
  );
}

export function JournalTable({ rows, timeZone }: { rows: readonly StreamLogRow[]; timeZone?: string }) {
  return (
    <div className="table-wrap">
      <table className="table journal">
        <thead>
          <tr>
            <th scope="col">Время</th>
            <th scope="col" className="num">
              Клиентов
            </th>
            <th scope="col">Преобладает</th>
            <th scope="col" className="num">
              Негатив
            </th>
            <th scope="col">Статус</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.from_ts}>
              <td className="time">{intervalText(r.from_ts, r.to_ts, timeZone)}</td>
              <td className="num">{r.clients}</td>
              <td>{EMOTION_LABEL[r.dominant_emotion]}</td>
              <td className={r.decision === "alert" || r.decision === "watch" ? "num hi" : "num"}>{prob(r.negative_prob)}</td>
              <td>
                <DecisionChip decision={r.decision} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
