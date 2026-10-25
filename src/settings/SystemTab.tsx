// Settings › Система: device, models, warnings (from /api/health) and live load.
import { appData, useFeedVersion } from "../state/appData";
import { useShell } from "../shell/context";
import { HealthView } from "../shell/health";
import { SystemLoadLine } from "../ui/controls";

export default function SystemTab() {
  const { health, healthError } = useShell();
  useFeedVersion();
  return (
    <section className="settings-section" aria-labelledby="system-title">
      <div className="page-head">
        <h1 id="system-title">Система</h1>
      </div>
      {healthError && !health && <p className="error-text">Сервер недоступен ({healthError}). Повторная попытка…</p>}
      {!healthError && !health && <p className="empty-note">Загрузка…</p>}
      {health && <HealthView health={health} stale={healthError !== null} />}
      <div className="panel-head system-load">
        <h3>Загрузка</h3>
      </div>
      {appData.system ? <SystemLoadLine load={appData.system} /> : <p className="empty-note">Нет данных</p>}
    </section>
  );
}
