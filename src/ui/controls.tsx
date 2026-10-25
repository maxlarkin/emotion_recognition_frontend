// Shared controls from ui.md: chips, status, setting rows, segmented, stepper, toggle, disclosure, dialog.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Decision, StreamState, SystemLoad } from "../api/types";
import { DECISION_LABEL, mb, percent, STATUS_LABEL, statusGroup } from "./format";
import { ChevronIcon } from "./icons";

export function DecisionChip({ decision }: { decision: Decision }) {
  return <span className={`chip chip-${decision}`}>{DECISION_LABEL[decision]}</span>;
}

export function StatusLabel({ state }: { state: StreamState }) {
  const g = statusGroup(state);
  return (
    <span className="status-label">
      <span className={`dot dot-${g}`} />
      {STATUS_LABEL[g]}
    </span>
  );
}

export function StatusBadge({ state }: { state: StreamState }) {
  const g = statusGroup(state);
  return <span className={`badge-outline text-${g}`}>{STATUS_LABEL[g]}</span>;
}

/** CPU, RAM and (GPU image) GPU and VRAM load, as on the streams grid and in Settings › Система. */
export function SystemLoadLine({ load }: { load: SystemLoad | null }) {
  if (!load) return null;
  return (
    <dl className="sysload" aria-label="Загрузка системы">
      <div>
        <dt>CPU</dt>
        <dd>{percent(load.cpu_pct)}</dd>
      </div>
      <div>
        <dt>RAM</dt>
        <dd>
          {mb(load.ram_used_mb)} / {mb(load.ram_total_mb)}
        </dd>
      </div>
      {load.gpu_util_pct !== null && (
        <div>
          <dt>GPU</dt>
          <dd>{percent(load.gpu_util_pct)}</dd>
        </div>
      )}
      {load.vram_used_mb !== null && load.vram_total_mb !== null && (
        <div>
          <dt>VRAM</dt>
          <dd>
            {mb(load.vram_used_mb)} / {mb(load.vram_total_mb)}
          </dd>
        </div>
      )}
    </dl>
  );
}

export function Tile({ label, value, sub, alert }: { label: string; value: ReactNode; sub?: string; alert?: boolean }) {
  return (
    <div className={alert ? "tile alert" : "tile"}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">
        {value}
        {sub && <span className="tile-sub">{sub}</span>}
      </span>
    </div>
  );
}

export function SettingRow({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="setting-row">
      {htmlFor ? (
        <label className="setting-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="setting-label">{label}</span>
      )}
      {children}
    </div>
  );
}

export interface Option<T> {
  value: T;
  label: string;
}

/** Single choice. `allowClear`: clicking the selected option clears it (bulk edit). */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  allowClear = false,
  className = "",
}: {
  label: string;
  options: readonly Option<T>[];
  value: T | null;
  onChange: (v: T | null) => void;
  allowClear?: boolean;
  className?: string;
}) {
  return (
    <div className={`segmented ${className}`} role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" aria-pressed={on} onClick={() => onChange(on && allowClear ? null : o.value)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Multiple choice chips (selected orange), e.g. negative emotions. */
export function MultiChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly Option<T>[];
  value: readonly T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <div className="segmented chips-select" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const fix = (v: number) => Number(v.toFixed(4));
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="Уменьшить" disabled={value <= min} onClick={() => onChange(fix(clamp(value - step)))}>
        −
      </button>
      <output aria-live="polite">{format(value)}</output>
      <button type="button" aria-label="Увеличить" disabled={value >= max} onClick={() => onChange(fix(clamp(value + step)))}>
        +
      </button>
    </div>
  );
}

export function Toggle({ label, on, onChange, showText = false }: { label: string; on: boolean; onChange: (v: boolean) => void; showText?: boolean }) {
  return (
    <button type="button" className="toggle" aria-pressed={on} aria-label={showText ? undefined : label} onClick={() => onChange(!on)}>
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      {showText && <span className="small">{label}</span>}
    </button>
  );
}

export function Disclosure({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="disclosure" aria-label={title}>
      <button type="button" className="disclosure-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <h3>{title}</h3>
        <ChevronIcon size={18} />
      </button>
      {open && (
        <div className="disclosure-body" id={id}>
          {children}
        </div>
      )}
    </section>
  );
}

/** Closes on outside pointerdown and Esc while `open`. */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useDismiss<HTMLDivElement>(true, onClose);
  const id = useId();
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, button")?.focus();
  }, [ref]);
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <h2 id={id}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Export-style dropdown button. */
export function DropdownButton({ label, items, align = "right" }: { label: string; items: { label: string; onSelect: () => void }[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div className="dropdown" ref={ref}>
      <button type="button" className="btn btn-sm menu-trigger" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        {label} <ChevronIcon />
      </button>
      {open && (
        <div role="menu" className={align === "right" ? "menu right" : "menu"}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Triggers a browser download of `url` as `filename`. */
export function download(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (url.startsWith("blob:")) window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
