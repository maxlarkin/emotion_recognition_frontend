import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { SessionsTable } from "./SessionsView";

const noop = () => {};

function session(over: Partial<SessionInfo> = {}): SessionInfo {
  return { id: "abc", kind: "live", stream_id: null, created_at: Date.UTC(2026, 9, 8, 10), duration: 75, status: "finished", ...over };
}

describe("SessionsTable", () => {
  it("shows the empty state", () => {
    expect(renderToStaticMarkup(<SessionsTable sessions={[]} onDelete={noop} />)).toContain("Сессий пока нет");
  });

  it("lists a finished session with downloads and delete", () => {
    const html = renderToStaticMarkup(<SessionsTable sessions={[session()]} onDelete={noop} />);
    for (const text of ["Начало", "Тип", "Длительность", "Статус", "Веб-камера", "1 мин 15 с", "завершена", "Удалить"]) {
      expect(html).toContain(text);
    }
    // exports come from the stub as data: URLs (STUBS.md)
    expect(html).toContain('href="data:text/csv;charset=utf-8,');
    expect(html).toContain('href="data:application/json;charset=utf-8,');
    expect(html).toContain('download="session-abc.csv"');
    expect(html).not.toContain("disabled");
  });

  it("disables delete while running", () => {
    const html = renderToStaticMarkup(<SessionsTable sessions={[session({ status: "running" })]} onDelete={noop} />);
    expect(html).toContain("идёт");
    expect(html).toContain("disabled");
  });
});

describe("file sessions in the list", () => {
  it.each(["queued", "processing"])("disables delete while a file is %s", (status) => {
    const html = renderToStaticMarkup(<SessionsTable sessions={[session({ kind: "file", status })]} onDelete={noop} />);
    expect(html).toContain("Файл");
    expect(html).toContain("disabled");
  });

  it.each(["done", "failed"])("allows delete of a %s file", (status) => {
    const html = renderToStaticMarkup(<SessionsTable sessions={[session({ kind: "file", status })]} onDelete={noop} />);
    expect(html).not.toContain("disabled");
  });
});
