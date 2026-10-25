// Settings › Камеры: search, selection, bulk panel, expandable per-camera settings (ui.md).
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api, ANALYSIS_FPS, DETECTION_SIZES, MIN_FACE_PX, type Stream, type StreamPatch, type StreamSettings } from "../api";
import { appData, useStreams } from "../state/appData";
import { useShell } from "../shell/context";
import { TYPE_OPTIONS } from "../streams/AddStreamDialog";
import { Segmented, SettingRow, Toggle } from "../ui/controls";
import { CAMERA_TYPE_DETECTION, CAMERA_TYPE_LABEL, siteLabel } from "../ui/format";
import { ChevronIcon, SearchIcon } from "../ui/icons";
import { bulkPatch, canApplyBulk, EMPTY_BULK, matchesCamera, type BulkDraft } from "./logic";
import { useUnsavedGuard } from "./SettingsPage";

const FPS_OPTIONS = ANALYSIS_FPS.map((v) => ({ value: v, label: `${v} к/с` }));
const SIZE_OPTIONS = DETECTION_SIZES.map((v) => ({ value: v, label: v === "auto" ? "Авто" : String(v) }));
const FACE_OPTIONS = MIN_FACE_PX.map((v) => ({ value: v, label: `${v} px` }));
const ON_OPTIONS = [
  { value: "on", label: "Вкл" },
  { value: "off", label: "Выкл" },
] as const;

export function cameraSummary(s: Stream): string {
  return s.settings.enabled ? `${CAMERA_TYPE_LABEL[s.camera_type]} · ${s.settings.analysis_fps} к/с` : "выключен";
}

export default function CamerasTab() {
  const { streams } = useStreams();
  const [params] = useSearchParams();
  const focus = params.get("camera");
  const { toast } = useShell();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(focus);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState<BulkDraft>(EMPTY_BULK);
  const [dirtyRows, setDirtyRows] = useState<Set<string>>(new Set());
  useUnsavedGuard(dirtyRows.size > 0);

  useEffect(() => setExpanded(focus), [focus]);
  useEffect(() => {
    if (focus) document.getElementById(`camera-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus, streams]);

  const visible = useMemo(() => (streams ?? []).filter((s) => matchesCamera(s, query)), [streams, query]);
  const allSelected = visible.length > 0 && visible.every((s) => selected.has(s.id));

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visible.map((s) => s.id)));
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const setDirty = (id: string, dirty: boolean) =>
    setDirtyRows((prev) => {
      if (prev.has(id) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });

  const applyBulk = async () => {
    const patch = bulkPatch(bulk);
    const ids = [...selected].filter((id) => streams?.some((s) => s.id === id));
    const results = await Promise.allSettled(ids.map((id) => api.updateStream(id, patch)));
    await appData.refreshStreams();
    const failed = ids.filter((_, i) => results[i].status === "rejected");
    if (failed.length === 0) {
      toast(`Настройки применены к камерам: ${ids.length}`);
      setBulk(EMPTY_BULK);
      setBulkOpen(false);
    } else {
      const names = failed.map((id) => streams?.find((s) => s.id === id)?.name ?? id).join(", ");
      toast(`Не удалось применить к камерам: ${names}`, true);
    }
  };

  return (
    <section className="settings-section" aria-labelledby="cams-title">
      <div className="page-head">
        <h1 id="cams-title">Камеры</h1>
        <div className="search cams-search">
          <label htmlFor="cam-q" className="sr-only">
            Поиск по названию, точке или адресу
          </label>
          <input id="cam-q" className="input" type="search" placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} />
          <SearchIcon />
        </div>
      </div>
      <div className="cams-bar">
        <label className="check-label">
          <input type="checkbox" className="checkbox" checked={allSelected} onChange={toggleAll} />
          Все камеры
        </label>
        <span className="muted small">выбрано: {selected.size}</span>
        <button type="button" className="btn btn-sm cams-bulk-btn" disabled={selected.size === 0} aria-expanded={bulkOpen} onClick={() => setBulkOpen(!bulkOpen)}>
          Настроить выбранные
        </button>
      </div>
      {bulkOpen && (
        <div className="bulk-panel" aria-label="Массовая настройка">
          <p className="caption secondary-text">Меняются только выбранные поля. Повторный клик снимает выбор.</p>
          <SettingRow label="Анализ">
            <Segmented
              label="Анализ"
              options={ON_OPTIONS}
              value={bulk.enabled === null ? null : bulk.enabled ? "on" : "off"}
              allowClear
              onChange={(v) => setBulk({ ...bulk, enabled: v === null ? null : v === "on" })}
            />
          </SettingRow>
          <SettingRow label="Тип камеры">
            <Segmented label="Тип камеры" options={TYPE_OPTIONS} value={bulk.camera_type} allowClear onChange={(v) => setBulk({ ...bulk, camera_type: v })} />
          </SettingRow>
          <SettingRow label="Размер кадра для поиска">
            <Segmented label="Размер кадра для поиска" options={SIZE_OPTIONS} value={bulk.detection_size} allowClear onChange={(v) => setBulk({ ...bulk, detection_size: v })} />
          </SettingRow>
          <SettingRow label="Частота анализа">
            <Segmented label="Частота анализа" options={FPS_OPTIONS} value={bulk.analysis_fps} allowClear onChange={(v) => setBulk({ ...bulk, analysis_fps: v })} />
          </SettingRow>
          <SettingRow label="Мин. размер лица">
            <Segmented label="Мин. размер лица" options={FACE_OPTIONS} value={bulk.min_face_px} allowClear onChange={(v) => setBulk({ ...bulk, min_face_px: v })} />
          </SettingRow>
          <div className="form-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setBulk(EMPTY_BULK);
                setBulkOpen(false);
              }}
            >
              Отмена
            </button>
            <button type="button" className="btn btn-primary" disabled={!canApplyBulk(bulk, selected.size)} onClick={applyBulk}>
              Применить
            </button>
          </div>
        </div>
      )}
      {!streams && <p className="empty-note">Загрузка…</p>}
      {streams && visible.length === 0 && <p className="empty-note">{streams.length === 0 ? "Камер пока нет" : "Ничего не найдено"}</p>}
      <ul className="cam-list">
        {visible.map((s) => (
          <CameraRow
            key={s.id}
            stream={s}
            checked={selected.has(s.id)}
            onCheck={() => toggleOne(s.id)}
            open={expanded === s.id}
            onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
            onDirty={(d) => setDirty(s.id, d)}
          />
        ))}
      </ul>
    </section>
  );
}

export interface Draft {
  name: string;
  site: string;
  url: string;
  camera_type: Stream["camera_type"];
  settings: StreamSettings;
}

/** Only fields the user changed: the server masks credentials in `url`, so an untouched url is never sent back. */
export function changedFields(s: Stream, d: Draft): StreamPatch {
  const patch: StreamPatch = {};
  if (d.name !== s.name) patch.name = d.name;
  if (d.site !== s.site) patch.site = d.site;
  if (d.url !== s.url) patch.url = d.url;
  if (d.camera_type !== s.camera_type) patch.camera_type = d.camera_type;
  const settings = Object.fromEntries(Object.entries(d.settings).filter(([k, v]) => s.settings[k as keyof StreamSettings] !== v));
  if (Object.keys(settings).length) patch.settings = settings;
  return patch;
}

const toDraft = (s: Stream): Draft => ({ name: s.name, site: s.site, url: s.url, camera_type: s.camera_type, settings: { ...s.settings } });

function CameraRow({
  stream,
  checked,
  onCheck,
  open,
  onToggle,
  onDirty,
}: {
  stream: Stream;
  checked: boolean;
  onCheck: () => void;
  open: boolean;
  onToggle: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { toast } = useShell();
  const [draft, setDraft] = useState<Draft>(() => toDraft(stream));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = JSON.stringify(toDraft(stream));
  const dirty = JSON.stringify(draft) !== base;
  const prevBase = useRef(base);
  // Server data changed (save, bulk apply): take it, unless the user has unsaved edits in this row.
  useEffect(() => {
    setDraft((d) => (JSON.stringify(d) === prevBase.current ? (JSON.parse(base) as Draft) : d));
    prevBase.current = base;
  }, [base]);
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  useEffect(() => onDirtyRef.current(dirty), [dirty]);
  useEffect(() => () => onDirtyRef.current(false), []); // a removed or filtered-out row no longer blocks navigation

  const set = (patch: Partial<StreamSettings>) => setDraft({ ...draft, settings: { ...draft.settings, ...patch } });
  const save = async () => {
    if (!draft.name.trim() || !draft.url.trim()) {
      setError("Название и адрес обязательны");
      return;
    }
    setBusy(true);
    try {
      await api.updateStream(stream.id, changedFields(stream, draft));
      await appData.refreshStreams();
      setError(null);
      toast(`Камера «${draft.name}» сохранена`);
    } catch (e) {
      setError(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Удалить поток «${stream.name}»? Анализ остановится, сеанс сохранится для экспорта.`)) return;
    try {
      await api.deleteStream(stream.id);
      await appData.refreshStreams();
      toast(`Поток «${stream.name}» удалён`);
    } catch (e) {
      toast(`Не удалось удалить: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  };
  const auto = CAMERA_TYPE_DETECTION[draft.camera_type];

  return (
    <li id={`camera-${stream.id}`} className={["cam-row", checked ? "selected" : "", open ? "open" : ""].join(" ")}>
      <div className="cam-head">
        <input type="checkbox" className="checkbox" checked={checked} onChange={onCheck} aria-label={`Выбрать ${stream.name}`} />
        <button type="button" className="cam-toggle" aria-expanded={open} onClick={onToggle}>
          <span className="cam-name">
            {stream.name} · <span className="secondary-text">{siteLabel(stream.site)}</span>
          </span>
          <span className="mono small secondary-text">{cameraSummary(stream)}</span>
          <ChevronIcon size={16} />
        </button>
      </div>
      {open && (
        <div className="cam-body">
          <SettingRow label="Анализ">
            <Toggle label="Анализ" on={draft.settings.enabled} onChange={(v) => set({ enabled: v })} />
          </SettingRow>
          <SettingRow label="Название" htmlFor={`n-${stream.id}`}>
            <input id={`n-${stream.id}`} className="input field-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </SettingRow>
          <SettingRow label="Точка" htmlFor={`s-${stream.id}`}>
            <input id={`s-${stream.id}`} className="input field-input" value={draft.site} onChange={(e) => setDraft({ ...draft, site: e.target.value })} />
          </SettingRow>
          <SettingRow label="Адрес потока" htmlFor={`u-${stream.id}`}>
            <input id={`u-${stream.id}`} className="input field-input mono" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          </SettingRow>
          <SettingRow label="Тип камеры">
            <Segmented label="Тип камеры" options={TYPE_OPTIONS} value={draft.camera_type} onChange={(v) => v && setDraft({ ...draft, camera_type: v })} />
          </SettingRow>
          <SettingRow label={`Размер кадра для поиска (авто: ${auto})`}>
            <Segmented label="Размер кадра для поиска" options={SIZE_OPTIONS} value={draft.settings.detection_size} onChange={(v) => v && set({ detection_size: v })} />
          </SettingRow>
          <SettingRow label="Частота анализа">
            <Segmented label="Частота анализа" options={FPS_OPTIONS} value={draft.settings.analysis_fps} onChange={(v) => v && set({ analysis_fps: v })} />
          </SettingRow>
          <SettingRow label="Мин. размер лица">
            <Segmented label="Мин. размер лица" options={FACE_OPTIONS} value={draft.settings.min_face_px} onChange={(v) => v && set({ min_face_px: v })} />
          </SettingRow>
          {error && <p className="error-text">{error}</p>}
          <div className="form-actions spread">
            <button type="button" className="btn btn-alert-outline" onClick={remove}>
              Удалить поток
            </button>
            <span className="form-actions">
              <button type="button" className="btn" disabled={!dirty || busy} onClick={() => setDraft(toDraft(stream))}>
                Отмена
              </button>
              <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={save}>
                Сохранить
              </button>
            </span>
          </div>
        </div>
      )}
    </li>
  );
}
