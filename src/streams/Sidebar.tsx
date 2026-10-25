// Left column: «Потоки», add button, search, webcam entry and streams grouped by site.
import { useState } from "react";
import { Link, NavLink, useParams } from "react-router";
import { useIncidents, useStreams } from "../state/appData";
import { useShell } from "../shell/context";
import { StatusLabel } from "../ui/controls";
import { GearIcon, PlusIcon, SearchIcon } from "../ui/icons";
import { groupStreams, matchesQuery, WEBCAM_ENTRY } from "./grouping";

export default function Sidebar() {
  const [query, setQuery] = useState("");
  const { streams, error } = useStreams();
  const incidents = useIncidents();
  const { setAddStreamOpen } = useShell();
  const { id: activeId } = useParams();
  const groups = groupStreams(streams ?? [], query);
  const showWebcam = matchesQuery(WEBCAM_ENTRY.name, WEBCAM_ENTRY.site, query);
  const withIncident = new Set(incidents.map((e) => e.stream_id));

  return (
    <aside className="sidebar" aria-label="Список потоков">
      <div className="sidebar-head">
        <h2>Потоки</h2>
        <button type="button" className="icon-btn accent" aria-label="Добавить поток" onClick={() => setAddStreamOpen(true)}>
          <PlusIcon />
        </button>
      </div>
      <div className="search">
        <label htmlFor="stream-q" className="sr-only">
          Поиск камеры или точки
        </label>
        <input id="stream-q" className="input" type="search" placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} />
        <SearchIcon />
      </div>
      {showWebcam && (
        <div className="group">
          <span className="group-title">{WEBCAM_ENTRY.site}</span>
          <ul className="cards">
            <li>
              <NavLink to="/live" className={({ isActive }) => (isActive ? "card-row active" : "card-row")}>
                <span className="card-main">
                  <span className="card-name">{WEBCAM_ENTRY.name}</span>
                  <span className="card-meta">Камера и микрофон браузера</span>
                </span>
              </NavLink>
            </li>
          </ul>
        </div>
      )}
      {error && !streams && <p className="error-text">Не удалось загрузить потоки ({error})</p>}
      {!streams && !error && <p className="empty-note">Загрузка…</p>}
      {groups.map((g) => (
        <div className="group" key={g.site}>
          <span className="group-title">{g.site}</span>
          <ul className="cards">
            {g.streams.map((s) => {
              const alert = withIncident.has(s.id);
              const cls = ["card-row", s.id === activeId ? "active" : "", alert ? "has-alert" : ""].join(" ");
              return (
                <li key={s.id} className={cls}>
                  <Link to={`/streams/${s.id}`} className="card-main" aria-current={s.id === activeId ? "page" : undefined}>
                    <span className="card-name">{s.name}</span>
                    <span className="card-meta">
                      <StatusLabel state={s.state} />
                      {alert && <span className="chip chip-incident">Инцидент</span>}
                    </span>
                  </Link>
                  <Link to={`/settings/cameras?camera=${encodeURIComponent(s.id)}`} className="card-gear" aria-label={`Настройки камеры ${s.name}`}>
                    <GearIcon />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {streams && query && groups.length === 0 && !showWebcam && <p className="empty-note">Ничего не найдено</p>}
    </aside>
  );
}
