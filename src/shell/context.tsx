// Shell-level state: health polling, toasts and the add-stream dialog, shared by toolbar and screens.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchHealth, type Health } from "../api";

const POLL_MS = 5000;
const TOAST_MS = 4000;

interface Toast {
  id: number;
  text: string;
  error: boolean;
}

interface ShellValue {
  health: Health | null;
  healthError: string | null;
  toast: (text: string, error?: boolean) => void;
  addStreamOpen: boolean;
  setAddStreamOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const v = useContext(ShellContext);
  if (!v) throw new Error("useShell outside ShellProvider");
  return v;
}

let toastSeq = 0;

export function ShellProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [addStreamOpen, setAddStreamOpen] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        setHealth(await fetchHealth(ctrl.signal));
        setHealthError(null);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setHealthError(e instanceof Error ? e.message : String(e));
      }
      timer = window.setTimeout(load, POLL_MS);
    };
    load();
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, []);

  const toast = useCallback((text: string, error = false) => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, text, error }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_MS);
  }, []);

  const value = useMemo(
    () => ({ health, healthError, toast, addStreamOpen, setAddStreamOpen }),
    [health, healthError, toast, addStreamOpen],
  );

  return (
    <ShellContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={t.error ? "toast error" : "toast"} role={t.error ? "alert" : "status"}>
            {t.text}
          </div>
        ))}
      </div>
    </ShellContext.Provider>
  );
}
