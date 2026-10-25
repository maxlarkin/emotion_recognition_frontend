// Health texts: the global warning banner under the toolbar and the Settings › Система view.
import type { Health, ModelKey } from "../api";

export const MODEL_LABELS: Record<ModelKey, string> = {
  yunet: "Детектор лиц (YuNet)",
  fer: "Эмоции по лицу (EmotiEffLib)",
  vad: "Детектор речи (Silero VAD)",
  ser: "Эмоции по голосу (GigaAM-Emo)",
};

const MODEL_KEYS = Object.keys(MODEL_LABELS) as ModelKey[];

const WARNINGS: Record<string, string> = {
  cuda_unavailable: "Образ собран для GPU, но видеокарта недоступна. Работа идёт на процессоре (CPU).",
  models_loading: "Модели загружаются. Анализ станет доступен через несколько секунд.",
  inference_failed:
    "Модуль распознавания не запустился. Подробности в журнале бэкенда; если не хватает файлов моделей, пересоберите образ.",
};

const UNKNOWN_WARNING = "Сервер сообщил о проблеме. Подробности смотрите в журнале бэкенда.";

export const warningText = (w: string): string => WARNINGS[w] ?? UNKNOWN_WARNING;

/** Banner under the toolbar: server unreachable, or a health warning. Renders nothing when healthy. */
export function HealthBannerView({ health, error }: { health: Health | null; error: string | null }) {
  let text: string | null = null;
  if (error) text = `Сервер недоступен (${error}). Повторная попытка…`;
  else if (health?.warning) text = warningText(health.warning);
  if (!text) return null;
  return (
    <div className="health-banner" role="alert">
      {text}
    </div>
  );
}

export function HealthView({ health, stale }: { health: Health; stale: boolean }) {
  const loading = health.warning === "models_loading";
  // While loading or after a failed start every model is false: the warning explains why, not missing files.
  const missing = loading || health.warning === "inference_failed" ? [] : MODEL_KEYS.filter((k) => !health.models[k]);
  return (
    <div className="health-view">
      {stale && <p className="error-text">Связь с сервером потеряна, показаны последние данные.</p>}
      <div className="setting-row">
        <span className="setting-label">Устройство</span>
        <strong>{loading ? "определяется…" : health.device === "cuda" ? "GPU (CUDA)" : "CPU"}</strong>
      </div>
      {health.gpu_name && (
        <div className="setting-row">
          <span className="setting-label">Видеокарта</span>
          <strong>{health.gpu_name}</strong>
        </div>
      )}
      <div className="setting-row">
        <span className="setting-label">Статус</span>
        <strong className={health.status === "ok" ? "text-live" : "error-text"}>{health.status === "ok" ? "всё готово" : "работа ограничена"}</strong>
      </div>
      {health.warning && (
        <p className="warn-box" role="alert" title={health.warning}>
          {warningText(health.warning)}
        </p>
      )}
      <h3 className="health-models-title">Модели</h3>
      <ul className="models">
        {MODEL_KEYS.map((k) => (
          <li key={k} className="setting-row">
            <span className="setting-label">{MODEL_LABELS[k]}</span>
            <span className={health.models[k] ? "text-live" : "error-text"}>
              <span aria-hidden="true">{health.models[k] ? "✓ " : "✗ "}</span>
              {health.models[k] ? "загружена" : loading ? "загружается" : "не загружена"}
            </span>
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <p className="error-text">Отсутствуют модели: {missing.map((k) => MODEL_LABELS[k]).join(", ")}. Пересоберите образ.</p>
      )}
    </div>
  );
}
