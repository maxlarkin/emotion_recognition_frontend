// Finished file result (CAP-3): header + export, player with overlay, emotion chart, tiles,
// episode timeline and table; selection synced between timeline, table and playback position.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type EmotionEvent, type FileSession, type Timeline } from "../api";
import FrameView from "../streams/FrameView";
import { download, DropdownButton, Tile } from "../ui/controls";
import { EMOTION_LABEL, mmss, percent, prob, resolution } from "../ui/format";
import { PauseIcon, PlayIcon } from "../ui/icons";
import { episodeAt, frameAt, groupSeries, noFaceSegments, toEpisodes, type Episode } from "./episodes";

export const MSG_UNPLAYABLE = "Браузер не может воспроизвести этот формат";
const NOTE_TEXT: Record<string, string> = {
  no_audio_track: "Нет аудиодорожки",
  no_faces_detected: "Лица не найдены",
  playback_unavailable: MSG_UNPLAYABLE,
};

export default function Result({ file }: { file: FileSession }) {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [events, setEvents] = useState<EmotionEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState(0); // ms
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setTimeline(null);
    setEvents(null);
    setError(null);
    setPos(0);
    setSelected(null);
    Promise.all([api.fetchTimeline(file.id), api.listEvents({ session_id: file.id, limit: 1000 })]).then(
      ([t, e]) => {
        if (!alive) return;
        setTimeline(t);
        setEvents(e);
      },
      (e) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [file.id]);

  const duration = file.duration_ms ?? timeline?.frames.at(-1)?.ts_ms ?? 0;
  const episodes = useMemo(() => toEpisodes(events ?? []), [events]);
  const gaps = useMemo(() => noFaceSegments(timeline?.frames ?? []), [timeline]);
  const negatives = episodes.filter((e) => e.kind === "negative").length;

  const select = (ep: Episode) => {
    setSelected(ep.id);
    setPos(ep.start);
  };
  const onTime = (ms: number) => {
    setPos(ms);
    const ep = episodeAt(episodes, ms);
    if (ep && ep.id !== selected) setSelected(ep.id);
  };

  const exportAs = (format: "csv" | "json") => download(api.fileExportUrl(file.id, format), `${file.file_name}.${format}`);

  return (
    <>
      <div className="page-head">
        <h1 className="ellipsis">{file.file_name}</h1>
        <span className="mono small secondary-text">
          {mmss(duration / 1000)} · {resolution(file.resolution)} · анализ 5 к/с
        </span>
        <div className="actions">
          <DropdownButton
            label="Экспорт"
            items={[
              { label: "Таблица кадров — CSV", onSelect: () => exportAs("csv") },
              { label: "Кадры и события — JSON", onSelect: () => exportAs("json") },
            ]}
          />
        </div>
      </div>
      {file.notes.length > 0 && (
        <p className="warn-box">{file.notes.map((n) => NOTE_TEXT[n] ?? n).join(" · ")}</p>
      )}
      {error && <p className="error-text">Не удалось загрузить результат ({error})</p>}
      {!timeline && !error && <p className="empty-note">Загрузка результата…</p>}
      {timeline && (
        <>
          <Player file={file} timeline={timeline} duration={duration} pos={pos} onTime={onTime} />
          <EmotionChart timeline={timeline} duration={duration} pos={pos} onSeek={onTime} />
          <div className="tiles">
            <Tile label="Инцидентов" value={String(negatives)} sub={`из ${episodes.length} эпизодов`} alert={negatives > 0} />
            <Tile label="Позитивных" value={String(episodes.length - negatives)} />
            <Tile label="Пригодных кадров" value={percent(file.usable_pct)} />
          </div>
          <EpisodeTimeline duration={duration} gaps={gaps} episodes={episodes} selected={selected} pos={pos} onSelect={select} />
          <EpisodesTable episodes={episodes} selected={selected} onSelect={select} />
        </>
      )}
    </>
  );
}

function Player({ file, timeline, duration, pos, onTime }: { file: FileSession; timeline: Timeline; duration: number; pos: number; onTime: (ms: number) => void }) {
  const media = api.fileMediaUrl(file.id);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  // the note already says it when the server could not make a playback copy
  const [unplayable, setUnplayable] = useState(false);
  const noted = file.notes.includes("playback_unavailable");
  const frame = frameAt(timeline.frames, pos);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  // While the video plays, follow its clock every animation frame (timeupdate fires only ~4 times
  // a second, slower than the 5 fps results), so the boxes stay on the faces.
  useEffect(() => {
    const v = videoRef.current;
    if (!playing || !v) return;
    let raf = 0;
    let last = -Infinity;
    const step = () => {
      const ms = v.currentTime * 1000;
      if (Math.abs(ms - last) >= 100) {
        // results come at 5 fps: re-rendering more often than every 100 ms shows nothing new
        last = ms;
        onTimeRef.current(ms);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Seek the video when pos changes from outside (timeline, table, chart).
  useEffect(() => {
    const v = videoRef.current;
    if (v && Math.abs(v.currentTime * 1000 - pos) > 400) v.currentTime = pos / 1000;
  }, [pos]);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused)
      v.play().catch(() => {
        if (v.error) setUnplayable(true);
      });
    else v.pause();
  };

  return (
    <section className="player" aria-label="Просмотр записи">
      <div className="video-box">
        <FrameView
          frameUrl={null}
          faces={frame?.faces ?? []}
          sourceResolution={frame ? [frame.width, frame.height] : file.resolution}
          media={
            <video
              ref={videoRef}
              className="player-video"
              src={media}
              onTimeUpdate={(e) => onTime(e.currentTarget.currentTime * 1000)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setUnplayable(true)}
            />
          }
        />
      </div>
      {unplayable && !noted && <p className="warn-box">{MSG_UNPLAYABLE}</p>}
      <div className="player-bar">
        <button type="button" className="icon-btn" aria-label={playing ? "Пауза" : "Воспроизвести"} onClick={toggle}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <input
          type="range"
          className="player-range"
          min={0}
          max={Math.max(1, duration)}
          step={200}
          value={pos}
          aria-label="Позиция"
          onChange={(e) => onTime(Number(e.target.value))}
        />
        <span className="mono small">
          {mmss(pos / 1000)} / {mmss(duration / 1000)}
        </span>
      </div>
    </section>
  );
}

const CHART_W = 1000;
const CHART_H = 120;

function EmotionChart({ timeline, duration, pos, onSeek }: { timeline: Timeline; duration: number; pos: number; onSeek: (ms: number) => void }) {
  const series = useMemo(() => groupSeries(timeline.frames, 200, duration), [timeline, duration]);
  const x = (t: number) => (t / Math.max(1, duration)) * CHART_W;
  const area = (top: (p: (typeof series)[number]) => number, bottom: (p: (typeof series)[number]) => number) => {
    const up = series.map((p) => `${x(p.t).toFixed(1)},${(CHART_H - top(p) * CHART_H).toFixed(1)}`);
    const down = [...series].reverse().map((p) => `${x(p.t).toFixed(1)},${(CHART_H - bottom(p) * CHART_H).toFixed(1)}`);
    return `M${up.join("L")}L${down.join("L")}Z`;
  };
  return (
    <section className="panel chart" aria-label="Эмоции во времени">
      <div className="panel-head">
        <h3>Эмоции во времени</h3>
        <span className="legend caption">
          <span className="swatch negative" /> Негатив <span className="swatch neutral" /> Нейтрально <span className="swatch positive" /> Позитив
        </span>
      </div>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        className="chart-svg"
        role="img"
        aria-label="Доли негатива, нейтрального и позитива по времени. Клик переводит просмотр к этому моменту"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - r.left) / r.width) * duration);
        }}
      >
        <path d={area((p) => p.negative, () => 0)} className="area-negative" />
        <path d={area((p) => p.negative + p.neutral, (p) => p.negative)} className="area-neutral" />
        <path d={area((p) => p.negative + p.neutral + p.positive, (p) => p.negative + p.neutral)} className="area-positive" />
        <line x1={x(pos)} x2={x(pos)} y1={0} y2={CHART_H} className="chart-cursor" />
      </svg>
    </section>
  );
}

function EpisodeTimeline({
  duration,
  gaps,
  episodes,
  selected,
  pos,
  onSelect,
}: {
  duration: number;
  gaps: readonly { start: number; end: number }[];
  episodes: readonly Episode[];
  selected: string | null;
  pos: number;
  onSelect: (e: Episode) => void;
}) {
  const pct = (ms: number) => `${(ms / Math.max(1, duration)) * 100}%`;
  return (
    <section className="panel" aria-label="Шкала времени">
      <div className="panel-head">
        <h3>Шкала времени</h3>
        <span className="legend caption">
          <span className="swatch gap" /> Нет лиц <span className="swatch negative" /> Инцидент <span className="swatch positive" /> Позитив
        </span>
      </div>
      <div className="timeline">
        {gaps.map((g) => (
          <span key={g.start} className="tl-gap" style={{ left: pct(g.start), width: pct(g.end - g.start) }} />
        ))}
        {episodes.map((e) => (
          <button
            key={e.id}
            type="button"
            className={`tl-ep ${e.kind}${selected === e.id ? " selected" : ""}`}
            style={{ left: pct(e.start), width: `max(6px, ${pct(e.end - e.start)})` }}
            aria-label={`${e.kind === "negative" ? "Инцидент" : "Позитив"} ${mmss(e.start / 1000)}–${mmss(e.end / 1000)}, клиент #${e.track}`}
            aria-pressed={selected === e.id}
            onClick={() => onSelect(e)}
          />
        ))}
        <span className="tl-cursor" style={{ left: pct(pos) }} />
      </div>
      <div className="tl-marks mono caption muted">
        {[0, 0.25, 0.5, 0.75, 1].map((k) => (
          <span key={k}>{mmss((duration * k) / 1000)}</span>
        ))}
      </div>
    </section>
  );
}

function EpisodesTable({ episodes, selected, onSelect }: { episodes: readonly Episode[]; selected: string | null; onSelect: (e: Episode) => void }) {
  if (episodes.length === 0) return <section className="panel"><span className="empty-note">Эпизодов не найдено</span></section>;
  return (
    <section className="panel" aria-label="Эпизоды">
      <h3>Эпизоды</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Время</th>
              <th scope="col">Клиент</th>
              <th scope="col">Эмоция</th>
              <th scope="col" className="num">
                Уверенность
              </th>
              <th scope="col">Тип</th>
            </tr>
          </thead>
          <tbody>
            {episodes.map((e) => (
              <tr
                key={e.id}
                className={`clickable${selected === e.id ? " selected" : ""}${e.kind === "negative" ? " negative" : ""}`}
                onClick={() => onSelect(e)}
              >
                <td className="time">
                  <button
                    type="button"
                    className="link-btn"
                    aria-pressed={selected === e.id}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onSelect(e);
                    }}
                  >
                    {mmss(e.start / 1000)}–{mmss(e.end / 1000)}
                  </button>
                </td>
                <td className="mono">#{e.track}</td>
                <td>{EMOTION_LABEL[e.emotion]}</td>
                <td className="num">{prob(e.prob)}</td>
                <td>{e.kind === "negative" ? <span className="chip chip-alert">Инцидент</span> : <span className="chip chip-positive">Позитив</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
