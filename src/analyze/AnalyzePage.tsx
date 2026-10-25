// `/analyze/:sessionId?` (mockup Analyze): drop zone, queue with progress, result or progress view.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, type FileSession } from "../api";
import { mmss, resolution } from "../ui/format";
import { UploadIcon } from "../ui/icons";
import Result from "./Result";

const POLL_MS = 1000;
const IDLE_POLL_MS = 10_000;
let rejSeq = 0;
export const ACCEPTED = ["mp4", "webm", "mkv", "avi"];
const MAX_BYTES = 2 * 1024 ** 3; // nginx client_max_body_size 2g

/** Client-side check before upload; Russian reason or null. */
export function rejectReason(file: Pick<File, "name" | "size">): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ACCEPTED.includes(ext)) return "Неподдерживаемый формат";
  if (file.size > MAX_BYTES) return "Файл больше 2 ГБ";
  return null;
}

interface Rejected {
  id: string;
  file_name: string;
  error: string;
}

/** A file whose bytes are still being sent (before it becomes a queued session). */
interface Sending {
  id: string;
  file_name: string;
  sent: number; // 0–1
}

export const sendingText = (sent: number): string => `Загрузка ${Math.round(sent * 100)} %`;

export const STATUS_TEXT: Record<FileSession["status"], string> = { done: "Готово", processing: "Обработка", queued: "В очереди", failed: "Ошибка" };

export function statusText(f: Pick<FileSession, "status" | "progress">): string {
  return f.status === "processing" ? `Обработка ${Math.round((f.progress ?? 0) * 100)} %` : STATUS_TEXT[f.status];
}

export default function AnalyzePage() {
  const { sessionId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [files, setFiles] = useState<FileSession[] | null>(null);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [sending, setSending] = useState<Sending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  const busy = files?.some((f) => f.status === "queued" || f.status === "processing") ?? true;

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.listFileSessions().then(
        (l) => alive && (setFiles(l), setError(null)),
        (e) => alive && setError(e instanceof Error ? e.message : String(e)),
      );
    load();
    // Poll fast only while something is queued or processing.
    const t = window.setInterval(load, busy ? POLL_MS : IDLE_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [busy]);

  // «Загрузить запись»: a file dialog cannot open without a user gesture, so focus the picker instead.
  useEffect(() => {
    if (!params.get("upload")) return;
    pickRef.current?.focus();
    setParams({}, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    if (!sessionId && files && files.length > 0) navigate(`/analyze/${files[0].id}`, { replace: true });
  }, [sessionId, files, navigate]);

  const upload = async (list: FileList | File[]) => {
    const accepted: { file: File; id: string }[] = [];
    for (const f of Array.from(list)) {
      const reason = rejectReason(f);
      if (reason) setRejected((r) => [{ id: `rej-${++rejSeq}`, file_name: f.name, error: reason }, ...r]);
      else accepted.push({ file: f, id: `up-${++rejSeq}` });
    }
    // Sent one after another, in the order picked: the server queues them in upload order.
    setSending((cur) => [...cur, ...accepted.map(({ file, id }) => ({ id, file_name: file.name, sent: 0 }))]);
    for (const { file, id } of accepted) {
      try {
        const s = await api.uploadFile(file, (sent) => setSending((cur) => cur.map((x) => (x.id === id ? { ...x, sent } : x))));
        setFiles((prev) => (prev ? [s, ...prev.filter((x) => x.id !== s.id)] : [s]));
      } catch (e) {
        setRejected((r) => [{ id: `rej-${++rejSeq}`, file_name: file.name, error: e instanceof Error ? e.message : String(e) }, ...r]);
      } finally {
        setSending((cur) => cur.filter((x) => x.id !== id));
      }
    }
  };

  const current = files?.find((f) => f.id === sessionId);

  return (
    <div className="with-sidebar">
      <aside className="sidebar" aria-label="Записи">
        <div className="sidebar-head">
          <h2>Записи</h2>
        </div>
        <div
          className={drag ? "dropzone drag" : "dropzone"}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void upload(e.dataTransfer.files);
          }}
        >
          <UploadIcon />
          <span>Перетащите видео сюда</span>
          <button type="button" ref={pickRef} className="btn btn-sm" onClick={() => inputRef.current?.click()}>
            Выбрать файлы
          </button>
          <span className="caption muted">MP4, WEBM, MKV, AVI · до 10 мин</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED.map((e) => `.${e}`).join(",")}
            className="sr-only"
            aria-label="Выбрать видеофайлы"
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {error && <p className="error-text">Не удалось загрузить очередь ({error})</p>}
        <ul className="cards">
          {sending.map((u) => (
            <li key={u.id} className="card-row file-card">
              <span className="card-main">
                <span className="card-name ellipsis">{u.file_name}</span>
                <span className="card-meta">
                  <span className="mono">—</span>
                  <span className="file-status processing">{sendingText(u.sent)}</span>
                </span>
                <span className="progress" role="progressbar" aria-label={`${u.file_name}: загрузка`} aria-valuenow={Math.round(u.sent * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ width: `${Math.round(u.sent * 100)}%` }} />
                </span>
              </span>
            </li>
          ))}
          {rejected.map((r) => (
            <li key={r.id} className="card-row file-card failed">
              <span className="card-main">
                <span className="card-name ellipsis">{r.file_name}</span>
                <span className="card-meta error-text">{r.error}</span>
              </span>
              <button type="button" className="icon-btn ghost" aria-label="Убрать из списка" onClick={() => setRejected((x) => x.filter((y) => y.id !== r.id))}>
                ×
              </button>
            </li>
          ))}
          {files?.map((f) => (
            <li key={f.id} className={f.id === sessionId ? "card-row file-card active" : "card-row file-card"}>
              <Link to={`/analyze/${f.id}`} className="card-main" aria-current={f.id === sessionId ? "page" : undefined}>
                <span className="card-name ellipsis">{f.file_name}</span>
                <span className="card-meta">
                  <span className="mono">
                    {f.duration_ms ? mmss(f.duration_ms / 1000) : "—"} · {resolution(f.resolution)}
                  </span>
                  <span className={`file-status ${f.status}`}>{statusText(f)}</span>
                </span>
                {f.status === "processing" && (
                  <span className="progress">
                    <span style={{ width: `${Math.round((f.progress ?? 0) * 100)}%` }} />
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
        {files && files.length === 0 && rejected.length === 0 && sending.length === 0 && <p className="empty-note">Записей пока нет</p>}
      </aside>
      <main className="content">
        {!current && files && files.length === 0 && <p className="empty-note">Загрузите запись, чтобы получить результат распознавания.</p>}
        {!current && sessionId && files && <p className="empty-note">Запись не найдена.</p>}
        {current && current.status === "done" && <Result file={current} key={current.id} />}
        {current && current.status !== "done" && <Pending file={current} />}
      </main>
    </div>
  );
}

function Pending({ file }: { file: FileSession }) {
  return (
    <div className="pending">
      <h1 className="ellipsis">{file.file_name}</h1>
      {file.status === "failed" ? (
        <p className="error-text">{file.error ?? "Не удалось обработать запись"}</p>
      ) : (
        <>
          <p className="pending-title">{file.status === "processing" ? `Обработка: ${Math.round((file.progress ?? 0) * 100)} %` : "Запись в очереди"}</p>
          <span className="progress wide">
            <span style={{ width: `${Math.round((file.progress ?? 0) * 100)}%` }} />
          </span>
          <p className="muted small">Результат появится здесь после обработки</p>
        </>
      )}
    </div>
  );
}
