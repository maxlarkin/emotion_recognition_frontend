// `/settings/:tab` (mockup Settings): vertical tabs, one row per setting, Save/Cancel, unsaved guard.
import { useEffect, useState } from "react";
import { Navigate, NavLink, useBlocker, useParams } from "react-router";
import { api, JOURNAL_INTERVALS, NEGATIVE_EMOTIONS, type AppSettings } from "../api";
import { useShell } from "../shell/context";
import { MultiChips, Segmented, SettingRow, Stepper } from "../ui/controls";
import { EMOTION_LABEL, prob } from "../ui/format";
import CamerasTab from "./CamerasTab";
import { RANGES, sameSettings, validateSettings } from "./logic";
import SystemTab from "./SystemTab";

const TABS = [
  { id: "events", label: "События" },
  { id: "cameras", label: "Камеры" },
  { id: "journal", label: "Журнал" },
  { id: "system", label: "Система" },
] as const;

const LEAVE_TEXT = "Есть несохранённые изменения. Уйти без сохранения?";

/** Blocks in-app navigation and tab close while `dirty`. */
export function useUnsavedGuard(dirty: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(LEAVE_TEXT)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
}

export default function SettingsPage() {
  const { tab = "events" } = useParams();
  if (!TABS.some((t) => t.id === tab)) return <Navigate to="/settings/events" replace />;
  return (
    <main className="content settings">
      <nav className="tabs" aria-label="Разделы настроек">
        {TABS.map((t) => (
          <NavLink key={t.id} to={`/settings/${t.id}`} className={({ isActive }) => (isActive ? "tab active" : "tab")}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <div className="tab-body">
        {(tab === "events" || tab === "journal") && <GlobalSettings tab={tab} key={tab} />}
        {tab === "cameras" && <CamerasTab />}
        {tab === "system" && <SystemTab />}
      </div>
    </main>
  );
}

function GlobalSettings({ tab }: { tab: "events" | "journal" }) {
  const { toast } = useShell();
  const [saved, setSaved] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = saved !== null && draft !== null && !sameSettings(saved, draft);
  useUnsavedGuard(dirty);

  useEffect(() => {
    api.fetchSettings().then(
      (s) => {
        setSaved(s);
        setDraft(s);
      },
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  if (!draft) return error ? <p className="error-text">Не удалось загрузить настройки ({error})</p> : <p className="empty-note">Загрузка…</p>;
  const ev = draft.events;
  const setEv = (patch: Partial<AppSettings["events"]>) => setDraft({ ...draft, events: { ...ev, ...patch } });
  const invalid = validateSettings(draft);

  const save = async () => {
    if (invalid) return;
    setBusy(true);
    try {
      const s = await api.saveSettings(draft);
      setSaved(s);
      setDraft(s);
      setError(null);
      toast("Настройки сохранены");
    } catch (e) {
      setError(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" aria-labelledby="settings-title">
      <div className="page-head">
        <h1 id="settings-title">{tab === "events" ? "События" : "Журнал"}</h1>
      </div>
      {tab === "events" ? (
        <div className="rows">
          <SettingRow label="Негативные эмоции">
            <MultiChips
              label="Негативные эмоции"
              options={NEGATIVE_EMOTIONS.map((e) => ({ value: e, label: EMOTION_LABEL[e] }))}
              value={ev.negative_emotions}
              onChange={(v) => setEv({ negative_emotions: v })}
            />
          </SettingRow>
          <SettingRow label="Порог негатива">
            <Stepper label="Порог негатива" {...RANGES.negative_threshold} value={ev.negative_threshold} format={prob} onChange={(v) => setEv({ negative_threshold: v })} />
          </SettingRow>
          <SettingRow label="Порог позитива">
            <Stepper label="Порог позитива" {...RANGES.positive_threshold} value={ev.positive_threshold} format={prob} onChange={(v) => setEv({ positive_threshold: v })} />
          </SettingRow>
          <SettingRow label="Эпизод не короче">
            <Stepper label="Эпизод не короче" {...RANGES.min_duration_s} value={ev.min_duration_s} format={(v) => `${v} с`} onChange={(v) => setEv({ min_duration_s: v })} />
          </SettingRow>
          <SettingRow label="Повтор на том же клиенте не чаще">
            <Stepper label="Повтор на том же клиенте не чаще" {...RANGES.cooldown_s} value={ev.cooldown_s} format={(v) => `${v} с`} onChange={(v) => setEv({ cooldown_s: v })} />
          </SettingRow>
        </div>
      ) : (
        <div className="rows">
          <SettingRow label="Интервал записи журнала">
            <Segmented
              label="Интервал записи журнала"
              options={JOURNAL_INTERVALS.map((v) => ({ value: v, label: `${v} с` }))}
              value={draft.journal.interval_s}
              onChange={(v) => v && setDraft({ ...draft, journal: { interval_s: v } })}
            />
          </SettingRow>
        </div>
      )}
      {(invalid || error) && <p className="error-text">{invalid ?? error}</p>}
      <div className="form-actions">
        <button type="button" className="btn" disabled={!dirty || busy} onClick={() => setDraft(saved)}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={!dirty || busy || invalid !== null} onClick={save}>
          Сохранить
        </button>
      </div>
    </section>
  );
}
