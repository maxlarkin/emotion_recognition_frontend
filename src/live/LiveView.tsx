import { useEffect, useRef, useState } from "react";
import { Tile } from "../ui/controls";
import { decimal } from "../ui/format";
import { faceText, fusedText, largestFace, voiceText, type MicState } from "./panel";
import { DEFAULT_FUSION, type FrameResult } from "./protocol";
import { EMPTY_READOUT, LiveRun, type Readout } from "./run";

const NOTICE_MS = 4000;
const pct = (w: number) => `${Math.round(w * 100)} %`;

type Phase = "idle" | "starting" | "running";

function cameraError(e: unknown): string {
  const name = e instanceof DOMException || e instanceof Error ? e.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Доступ к камере запрещён. Разрешите его в настройках браузера и нажмите «Старт» снова.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Камера не найдена. Подключите камеру и попробуйте снова.";
    case "NotReadableError":
    case "AbortError":
      return "Камера занята другим приложением или недоступна.";
    default:
      return `Не удалось включить камеру${name ? ` (${name})` : ""}.`;
  }
}

function formatMs(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)} мс`;
}

/** `/live`: browser webcam and microphone session (CAP-1, CAP-2). */
export default function LiveView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runRef = useRef<LiveRun | null>(null);
  const attemptRef = useRef(0); // bumped by Stop/unmount: a pending camera request is then discarded
  const noticeTimerRef = useRef(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [readout, setReadout] = useState<Readout>(EMPTY_READOUT);
  const [micWanted, setMicWanted] = useState(true);
  const micWantedRef = useRef(true);
  const [micState, setMicState] = useState<MicState>("off");
  const [result, setResult] = useState<FrameResult | null>(null);

  useEffect(
    () => () => {
      attemptRef.current++;
      window.clearTimeout(noticeTimerRef.current);
      runRef.current?.stop();
    },
    [],
  );

  const stop = () => {
    attemptRef.current++;
    window.clearTimeout(noticeTimerRef.current);
    runRef.current?.stop();
    runRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setResult(null);
    setPhase("idle");
  };

  const toggleMic = () => {
    const on = !micWantedRef.current;
    micWantedRef.current = on;
    setMicWanted(on);
    runRef.current?.setMicWanted(on);
  };

  const start = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || runRef.current) return;
    setError(null);
    setNotice(null);
    setReadout(EMPTY_READOUT);
    setResult(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Браузер не даёт доступа к камере. Откройте приложение по адресу localhost (без HTTPS камера доступна только там).");
      return;
    }
    setPhase("starting");
    const attempt = ++attemptRef.current;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e) {
      if (attempt !== attemptRef.current) return;
      setError(cameraError(e));
      setPhase("idle");
      return;
    }
    if (attempt !== attemptRef.current) {
      stream.getTracks().forEach((t) => t.stop()); // stopped while the camera was opening
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // autoplay of a muted stream is allowed; a failure here is reported by the capture loop
    }
    if (attempt !== attemptRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const run = new LiveRun(stream, video, canvas, {
      onSession: () => {
        setPhase("running");
      },
      onFatal: (message) => {
        if (runRef.current !== run) return;
        stop();
        setError(message);
      },
      onNotice: (message) => {
        setNotice(message);
        window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
      },
      onStats: setReadout,
      onResult: (res) => {
        if (runRef.current === run) setResult(res);
      },
      onMic: (state) => {
        if (runRef.current === run) setMicState(state);
      },
    }, micWantedRef.current);
    runRef.current = run;
  };

  const p95Class = readout.p95 === null ? "" : readout.p95 < 1000 ? "text-live" : "error";
  const running = phase === "running";
  const face = result ? largestFace(result.faces) : null;
  const voice = running ? voiceText(micState, result?.audio ?? null) : micWanted ? "—" : "микрофон выключен";

  return (
    <main className="content live" aria-labelledby="live-title">
      <div className="page-head">
        <h1 id="live-title">Веб-камера</h1>
        <span className={`badge-outline ${running ? "text-live" : phase === "starting" ? "text-connecting" : "text-offline"}`}>
          {running ? "В эфире" : phase === "starting" ? "Подключение" : "Выключена"}
        </span>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={start} disabled={phase !== "idle"}>
            {phase === "starting" ? "Подключение…" : "Старт"}
          </button>
          <button type="button" className="btn" onClick={stop} disabled={phase === "idle"}>
            Стоп
          </button>
          <button
            type="button"
            className="btn"
            onClick={toggleMic}
            aria-pressed={micWanted}
            title={micWanted ? "Выключить микрофон" : "Включить микрофон"}
          >
            {micWanted ? "Микрофон вкл" : "Микрофон выкл"}
          </button>
        </div>
      </div>
      <div className="tiles">
        <Tile label="Задержка p50" value={formatMs(readout.p50)} />
        <Tile label="Задержка p95" value={<span className={p95Class}>{formatMs(readout.p95)}</span>} alert={p95Class === "error"} />
        <Tile label="Ответов в секунду" value={decimal(readout.rate, 1)} sub={`${readout.count} за 60 с`} />
      </div>
      <div className="video-row">
        <section aria-label="Видео с веб-камеры" className="video-box">
          <div className="stage">
            <video ref={videoRef} autoPlay muted playsInline />
            <canvas ref={canvasRef} aria-hidden="true" />
            {phase === "idle" && <p className="stage-hint">Нажмите «Старт», чтобы включить камеру и начать анализ</p>}
            {running && (
              <span className="live-badge">
                <span className="dot live-dot" />
                LIVE
              </span>
            )}
          </div>
        </section>
        <section aria-label="Результат" className="panel visitors">
          <h3>Посетитель</h3>
          <dl className="readout-list" aria-live="off">
            <div>
              <dt>Лицо</dt>
              <dd>{running && result ? faceText(face) : "—"}</dd>
            </div>
            <div>
              <dt>Голос</dt>
              <dd>{voice}</dd>
            </div>
            <div>
              <dt>Итог</dt>
              <dd>{running && result ? fusedText(face) : "—"}</dd>
            </div>
          </dl>
          <p className="caption muted">
            «Лицо» и «Итог» — для самого крупного лица в кадре. «Итог» объединяет лицо ({pct(DEFAULT_FUSION.w_face)}) и голос ({pct(DEFAULT_FUSION.w_audio)}), пока
            звучит речь; без речи он совпадает с «Лицо». Задержка — от захвата кадра до отрисовки рамки, за последние 60 секунд. Цель: p95 меньше 1000 мс.
          </p>
        </section>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="warn-box" role="status">
          {notice}
        </p>
      )}
    </main>
  );
}
