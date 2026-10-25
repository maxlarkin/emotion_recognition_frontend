// Add-stream dialog (ui.md): name, site, RTSP address, camera type, connection test.
import { useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, type CameraType, type StreamTestResult } from "../api";
import { appData, useStreams } from "../state/appData";
import { useShell } from "../shell/context";
import { Dialog, Segmented } from "../ui/controls";
import { CAMERA_TYPE_LABEL, resolution } from "../ui/format";
import { siteNames } from "./grouping";

const TYPES: CameraType[] = ["webcam", "sector", "security"];
export const TYPE_OPTIONS = TYPES.map((t) => ({ value: t, label: CAMERA_TYPE_LABEL[t] }));

export function canAddStream(name: string, url: string): boolean {
  return name.trim().length > 0 && url.trim().length > 0;
}

export default function AddStreamDialog() {
  const { setAddStreamOpen, toast } = useShell();
  const { streams } = useStreams();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState<CameraType>("sector");
  const [test, setTest] = useState<StreamTestResult | "pending" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), site: useId(), url: useId(), sites: useId() };
  const close = () => setAddStreamOpen(false);

  const urlRef = useRef(url);
  urlRef.current = url;
  const runTest = async () => {
    const tested = url;
    setTest("pending");
    let r: StreamTestResult;
    try {
      r = await api.testStream(tested);
    } catch (e) {
      r = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (urlRef.current === tested) setTest(r); // ignore a result for an address edited meanwhile
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAddStream(name, url)) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.createStream({ name, site, url, camera_type: type });
      await appData.refreshStreams();
      toast(`Поток «${s.name}» добавлен`);
      close();
      navigate(`/streams/${s.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Добавить поток" onClose={close}>
      <form className="form" onSubmit={submit}>
        <label className="field" htmlFor={ids.name}>
          <span>Название</span>
          <input id={ids.name} className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field" htmlFor={ids.site}>
          <span>Точка</span>
          <input id={ids.site} className="input" value={site} list={ids.sites} onChange={(e) => setSite(e.target.value)} placeholder="Например, Тверская" />
          <datalist id={ids.sites}>
            {siteNames(streams ?? []).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className="field" htmlFor={ids.url}>
          <span>Адрес</span>
          <input
            id={ids.url}
            className="input mono"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setTest(null);
            }}
            placeholder="rtsp://адрес:554/поток"
            required
          />
        </label>
        <div className="field">
          <span>Тип камеры</span>
          <Segmented label="Тип камеры" options={TYPE_OPTIONS} value={type} onChange={(v) => v && setType(v)} />
        </div>
        <div className="test-row">
          <button type="button" className="btn btn-sm" disabled={!url.trim() || test === "pending"} onClick={runTest}>
            {test === "pending" ? "Проверка…" : "Проверить"}
          </button>
          {test && test !== "pending" && (
            <span className={test.ok ? "small text-live" : "error-text"} role="status">
              {test.ok ? `Подключение есть: ${resolution(test.resolution)}, ${test.has_audio ? "есть звук" : "без звука"}` : test.error}
            </span>
          )}
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={close}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canAddStream(name, url) || busy}>
            Добавить
          </button>
        </div>
      </form>
    </Dialog>
  );
}
