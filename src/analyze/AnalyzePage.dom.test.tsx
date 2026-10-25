// @vitest-environment jsdom
// Upload of picked files (CAP-3): sent one after another in pick order, each shown as a
// «Загрузка N %» card while its bytes go out; the card goes away on success and on rejection.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSession } from "../api";
import AnalyzePage from "./AnalyzePage";

const { listFileSessions, uploadFile } = vi.hoisted(() => ({ listFileSessions: vi.fn(), uploadFile: vi.fn() }));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: { ...actual.api, listFileSessions, uploadFile } };
});

function session(id: string, file_name: string): FileSession {
  return { id, file_name, created_at: 1, status: "queued", progress: 0, duration_ms: null, resolution: null, notes: [], error: null, usable_pct: null };
}

interface Call {
  file: File;
  progress: (sent: number) => void;
  resolve: (s: FileSession) => void;
  reject: (e: Error) => void;
}

let calls: Call[];

beforeEach(() => {
  calls = [];
  listFileSessions.mockResolvedValue([]);
  uploadFile.mockImplementation(
    (file: File, progress: (sent: number) => void) => new Promise<FileSession>((resolve, reject) => calls.push({ file, progress, resolve, reject })),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const flush = () => act(async () => {});

async function pick(...names: string[]) {
  render(
    <MemoryRouter initialEntries={["/analyze"]}>
      <Routes>
        <Route path="/analyze/:sessionId?" element={<AnalyzePage />} />
      </Routes>
    </MemoryRouter>,
  );
  await flush();
  const input = screen.getByLabelText("Выбрать видеофайлы") as HTMLInputElement;
  fireEvent.change(input, { target: { files: names.map((n) => new File(["x"], n)) } });
  await flush();
}

describe("AnalyzePage upload", () => {
  it("sends files one after another in pick order with a progress card", async () => {
    await pick("a.mp4", "b.mkv");
    expect(calls.map((c) => c.file.name)).toEqual(["a.mp4"]); // the second waits for the first
    expect(screen.getAllByText("Загрузка 0 %")).toHaveLength(2);

    act(() => calls[0].progress(0.25));
    expect(screen.getByText("Загрузка 25 %")).toBeTruthy();

    await act(async () => calls[0].resolve(session("s1", "a.mp4")));
    expect(calls.map((c) => c.file.name)).toEqual(["a.mp4", "b.mkv"]);
    expect(screen.queryByText("Загрузка 25 %")).toBeNull();
    expect(screen.getAllByText(/^Загрузка /)).toHaveLength(1); // only b.mkv is still sending

    await act(async () => calls[1].reject(new Error("Файл больше 2 ГБ")));
    expect(screen.queryByText(/^Загрузка /)).toBeNull();
    expect(screen.getByText("Файл больше 2 ГБ")).toBeTruthy();
  });

  it("rejects a wrong format without sending it", async () => {
    await pick("x.mov");
    expect(uploadFile).not.toHaveBeenCalled();
    expect(screen.getByText("Неподдерживаемый формат")).toBeTruthy();
  });
});
