// Sticky 44 px toolbar: logo, four click-open menus, bell with new incidents (ui.md Routes and menus).
import { useCallback, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { appData, INCIDENTS_LIMIT, useIncidents, useStreams } from "../state/appData";
import { useDismiss } from "../ui/controls";
import { cameraName, clock, eventTime, INCIDENT_LABEL, isMediaTime } from "../ui/format";
import { BellIcon, ChevronIcon, LogoIcon } from "../ui/icons";
import { useShell } from "./context";

interface MenuItem {
  label: string;
  to?: string;
  action?: "add-stream";
}

export const MENUS: { id: string; label: string; items: MenuItem[] }[] = [
  {
    id: "streams",
    label: "Потоки",
    items: [
      { label: "Все потоки", to: "/streams" },
      { label: "Веб-камера", to: "/live" },
      { label: "Добавить поток", action: "add-stream" },
    ],
  },
  {
    id: "history",
    label: "История",
    items: [
      { label: "Журнал событий", to: "/history/events" },
      { label: "Сеансы и экспорт", to: "/history/sessions" },
    ],
  },
  {
    id: "settings",
    label: "Настройки",
    items: [
      { label: "События", to: "/settings/events" },
      { label: "Камеры", to: "/settings/cameras" },
      { label: "Журнал", to: "/settings/journal" },
      { label: "Система", to: "/settings/system" },
    ],
  },
  {
    id: "video",
    label: "Анализ видео",
    items: [
      { label: "Загрузить запись", to: "/analyze?upload=1" },
      { label: "Результаты", to: "/analyze" },
    ],
  },
];

export default function Toolbar() {
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const navRef = useDismiss<HTMLDivElement>(open !== null, close);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { setAddStreamOpen } = useShell();
  const showBell = pathname.startsWith("/streams") || pathname.startsWith("/live");

  const run = (it: MenuItem) => {
    close();
    if (it.action === "add-stream") {
      if (!pathname.startsWith("/streams")) navigate("/streams");
      setAddStreamOpen(true);
    } else if (it.to) navigate(it.to);
  };

  return (
    <header className="toolbar">
      <div className="toolbar-inner" ref={navRef}>
        <Link to="/streams" className="logo" aria-label="EmoSense — к потокам">
          <LogoIcon />
          <span>EmoSense</span>
        </Link>
        <nav aria-label="Главное меню" className="toolbar-nav">
          {MENUS.map((m) => {
            const isOpen = open === m.id;
            return (
              <div className="dropdown" key={m.id}>
                <button type="button" className="menu-btn" aria-expanded={isOpen} aria-haspopup="menu" onClick={() => setOpen(isOpen ? null : m.id)}>
                  <span>{m.label}</span>
                  <ChevronIcon />
                </button>
                {isOpen && (
                  <div role="menu" className="menu">
                    {m.items.map((it) => (
                      <button key={it.label} type="button" role="menuitem" className="menu-item" onClick={() => run(it)}>
                        {it.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        {showBell && <Bell open={open === "alerts"} onToggle={() => setOpen(open === "alerts" ? null : "alerts")} onClose={close} />}
      </div>
    </header>
  );
}

function Bell({ open, onToggle, onClose }: { open: boolean; onToggle: () => void; onClose: () => void }) {
  const incidents = useIncidents();
  const { streams } = useStreams();
  const navigate = useNavigate();
  return (
    <div className="dropdown bell">
      <button type="button" className="bell-btn" aria-label={`Уведомления: новых инцидентов ${incidents.length}`} aria-expanded={open} onClick={onToggle}>
        <BellIcon />
        {incidents.length > 0 && <span className="bell-count">{incidents.length >= INCIDENTS_LIMIT - 1 ? "99+" : incidents.length}</span>}
      </button>
      {open && (
        <div role="menu" className="menu right bell-menu">
          {incidents.length === 0 && <p className="empty-note bell-empty">Новых инцидентов нет</p>}
          {incidents.slice(0, 8).map((e) => (
            <button
              key={e.event_id}
              type="button"
              role="menuitem"
              className="menu-item bell-item"
              onClick={() => {
                onClose();
                if (e.stream_id) {
                  appData.hidden.delete(e.event_id);
                  navigate(`/streams/${e.stream_id}`);
                } else navigate(isMediaTime(e.emit_ts) ? `/analyze/${e.session_id}` : "/history/events");
              }}
            >
              <span className="dot dot-alert" />
              <span className="bell-text">
                <span className="bell-title">
                  {cameraName(e, streams)} · #{e.track_id}
                </span>
                <span className="caption secondary-text">
                  {isMediaTime(e.emit_ts) ? eventTime(e.emit_ts) : clock(e.emit_ts)} · {INCIDENT_LABEL.new.toLowerCase()}
                </span>
              </span>
            </button>
          ))}
          <Link to="/history/events?kind=negative&state=new" className="menu-item small" onClick={onClose}>
            Все инциденты в журнале
          </Link>
        </div>
      )}
    </div>
  );
}
