// @vitest-environment jsdom
// Reload behaviour of the «Сеансы и экспорт» list. The live screen and the list are separate routes
// since story 1.6: the list loads when opened and polls while a session runs (the server finishes a
// webcam session just after its socket closes).
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import SessionsView from "./SessionsView";

const fetchSessions = vi.hoisted(() => vi.fn());

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  fetchSessions,
  deleteSession: vi.fn(),
}));

function session(status: SessionInfo["status"]): SessionInfo {
  return { id: "s1", kind: "live", stream_id: null, created_at: Date.UTC(2026, 9, 8, 10), duration: 75, status };
}

/** Lets resolved fetches and the state updates after them settle. */
const flush = () => act(async () => {});
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  fetchSessions.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SessionsView reloads", () => {
  it("loads once when opened", async () => {
    fetchSessions.mockResolvedValue([session("finished")]);
    render(<SessionsView />);
    await flush();
    expect(fetchSessions).toHaveBeenCalledTimes(1);
    expect(screen.getByText("завершена")).toBeTruthy();
    await advance(10_000);
    expect(fetchSessions).toHaveBeenCalledTimes(1); // nothing runs, so no polling either
  });

  it("polls every 5 s while a session runs and stops once it is finished", async () => {
    fetchSessions.mockResolvedValue([session("running")]);
    render(<SessionsView />);
    await flush();
    await advance(5000);
    expect(fetchSessions).toHaveBeenCalledTimes(2);
    fetchSessions.mockResolvedValue([session("finished")]);
    await advance(5000);
    expect(fetchSessions).toHaveBeenCalledTimes(3);
    expect(screen.getByText("завершена")).toBeTruthy();
    await advance(15_000);
    expect(fetchSessions).toHaveBeenCalledTimes(3);
  });

  it("the «Обновить» button reloads and a newer load aborts the older one", async () => {
    fetchSessions.mockResolvedValue([session("finished")]);
    render(<SessionsView />);
    await flush();
    const firstSignal: AbortSignal = fetchSessions.mock.calls[0][0];
    act(() => screen.getByRole("button", { name: "Обновить" }).click());
    await flush();
    expect(fetchSessions).toHaveBeenCalledTimes(2);
    expect(firstSignal.aborted).toBe(true);
  });

  it("aborts the pending load on unmount", async () => {
    fetchSessions.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<SessionsView />);
    const signal: AbortSignal = fetchSessions.mock.calls[0][0];
    unmount();
    expect(signal.aborted).toBe(true);
    await advance(2000);
    expect(fetchSessions).toHaveBeenCalledTimes(1);
  });
});
