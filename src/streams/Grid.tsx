// `/streams`: all RTSP tiles with system load (CAP-10), or the empty state (mockup Empty).
import { Link } from "react-router";
import type { Stream } from "../api";
import { appData, streamNow, useFeedVersion, useStreams } from "../state/appData";
import { useShell } from "../shell/context";
import { DecisionChip, StatusLabel, SystemLoadLine } from "../ui/controls";
import { fps, siteLabel, streamVoice } from "../ui/format";
import { CameraIcon } from "../ui/icons";
import FrameView from "./FrameView";

export default function Grid() {
  const { streams, error } = useStreams();
  useFeedVersion();
  const { setAddStreamOpen } = useShell();

  if (!streams) return <main className="content">{error ? <p className="error-text">Не удалось загрузить потоки ({error})</p> : <p className="empty-note">Загрузка…</p>}</main>;
  if (streams.length === 0) return <EmptyState onAdd={() => setAddStreamOpen(true)} />;

  return (
    <main className="content">
      <div className="page-head">
        <h1>Все потоки</h1>
        <span className="muted">{streams.length}</span>
        <SystemLoadLine load={appData.system} />
      </div>
      <div className="grid">
        {streams.map((s) => (
          <StreamTile key={s.id} stream={s} />
        ))}
      </div>
    </main>
  );
}

const ms = (v: number | null) => (v === null ? "—" : `${Math.round(v)}`);

function StreamTile({ stream }: { stream: Stream }) {
  const { feed, live, result, faces, decision } = streamNow(stream);
  return (
    <Link to={`/streams/${stream.id}`} className="tile-card" aria-label={`${stream.site} · ${stream.name}`}>
      <FrameView frameUrl={live ? feed.frameUrl : null} faces={faces} sourceResolution={stream.source_resolution} compact>
        {!live && (
          <span className="frame-off">
            <StatusLabel state={stream.state} />
          </span>
        )}
      </FrameView>
      <span className="tile-card-body">
        <span className="tile-card-title">
          <span className="tile-card-name">{stream.name}</span>
          {decision && <DecisionChip decision={decision} />}
        </span>
        <span className="tile-card-meta">
          <StatusLabel state={stream.state} />
          <span className="mono">{result ? fps(result.fps) : "—"}</span>
          <span className="mono" title="Задержка p50 / p95, мс">
            {ms(feed.stats.p50)}/{ms(feed.stats.p95)} мс
          </span>
        </span>
        <span className="tile-card-meta">
          <span>{siteLabel(stream.site)}</span>
          <span>Голос: {streamVoice(stream.has_audio, result?.audio ?? null)}</span>
        </span>
      </span>
    </Link>
  );
}

export function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <main className="content empty-state">
      <div className="empty-icon">
        <CameraIcon />
      </div>
      <h1>Потоков пока нет</h1>
      <p className="secondary-text">Добавьте поток с IP-камеры по ссылке RTSP — распознавание эмоций начнётся сразу после подключения.</p>
      <div className="empty-actions">
        <button type="button" className="btn btn-primary" onClick={onAdd}>
          Добавить поток
        </button>
        <Link to="/analyze" className="btn">
          Проанализировать запись
        </Link>
      </div>
    </main>
  );
}
