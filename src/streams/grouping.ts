// Sidebar grouping and search (ui.md Streams sidebar).
import type { Stream } from "../api/types";
import { siteLabel } from "../ui/format";

export const WEBCAM_ENTRY = { name: "Веб-камера", site: "Этот компьютер" };

export interface StreamGroup {
  site: string;
  streams: Stream[];
}

const norm = (s: string) => s.trim().toLocaleLowerCase("ru");

export function matchesQuery(name: string, site: string, query: string): boolean {
  const q = norm(query);
  return !q || norm(`${name} ${site}`).includes(q);
}

/** Groups by site in first-seen order; empty site → «Без точки»; groups with no match are dropped. */
export function groupStreams(streams: readonly Stream[], query: string): StreamGroup[] {
  const groups = new Map<string, Stream[]>();
  for (const s of streams) {
    const site = siteLabel(s.site);
    if (!matchesQuery(s.name, site, query)) continue;
    const list = groups.get(site);
    if (list) list.push(s);
    else groups.set(site, [s]);
  }
  return [...groups].map(([site, list]) => ({ site, streams: list }));
}

export function siteNames(streams: readonly Stream[]): string[] {
  return [...new Set(streams.map((s) => s.site.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
}
