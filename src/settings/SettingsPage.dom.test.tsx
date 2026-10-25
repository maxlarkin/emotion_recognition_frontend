// @vitest-environment jsdom
// Unsaved-settings guard on the «События» and «Журнал» tabs: leaving with changes asks for confirmation;
// «Отмена» drops the changes and «Сохранить» stores them, after which leaving does not ask.
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type DataRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "../api";
import SettingsPage from "./SettingsPage";

const { fetchSettings, saveSettings, toast } = vi.hoisted(() => ({ fetchSettings: vi.fn(), saveSettings: vi.fn(), toast: vi.fn() }));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: { ...actual.api, fetchSettings, saveSettings } };
});
vi.mock("../shell/context", () => ({ useShell: () => ({ toast }) }));

const LEAVE_TEXT = "Есть несохранённые изменения. Уйти без сохранения?";
let stored: AppSettings;
let router: DataRouter;

async function setup() {
  router = createMemoryRouter([{ path: "/settings/:tab", element: <SettingsPage /> }], { initialEntries: ["/settings/events"] });
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "События" });
  return userEvent.setup();
}

const threshold = () => within(screen.getByRole("group", { name: "Порог негатива" }));
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const path = () => router.state.location.pathname;

beforeEach(() => {
  stored = structuredClone(DEFAULT_SETTINGS);
  fetchSettings.mockImplementation(async () => structuredClone(stored));
  saveSettings.mockImplementation(async (s: AppSettings) => {
    stored = structuredClone(s);
    return structuredClone(stored);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  fetchSettings.mockReset();
  saveSettings.mockReset();
  toast.mockReset();
});

describe("Settings unsaved guard", () => {
  it("leaves without asking when nothing changed", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const user = await setup();
    expect(button("Сохранить").disabled).toBe(true);
    await user.click(screen.getByRole("link", { name: "Журнал" }));
    await screen.findByRole("heading", { name: "Журнал" });
    expect(confirm).not.toHaveBeenCalled();
    expect(path()).toBe("/settings/journal");
  });

  it("asks before leaving with changes; declining keeps the tab and the draft", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = await setup();
    await user.click(threshold().getByRole("button", { name: "Увеличить" }));
    expect(threshold().getByText("0,65")).toBeTruthy();
    expect(button("Сохранить").disabled).toBe(false);

    await user.click(screen.getByRole("link", { name: "Журнал" }));
    expect(confirm).toHaveBeenCalledWith(LEAVE_TEXT);
    expect(path()).toBe("/settings/events");
    expect(screen.getByRole("heading", { name: "События" })).toBeTruthy();
    expect(threshold().getByText("0,65")).toBeTruthy();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("confirming leaves without saving", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = await setup();
    await user.click(threshold().getByRole("button", { name: "Увеличить" }));
    await user.click(screen.getByRole("link", { name: "Журнал" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    await screen.findByRole("heading", { name: "Журнал" });
    expect(path()).toBe("/settings/journal");
    expect(saveSettings).not.toHaveBeenCalled();
    expect(stored.events.negative_threshold).toBe(0.6);
  });

  it("guards the «Журнал» tab too", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = await setup();
    await user.click(screen.getByRole("link", { name: "Журнал" }));
    await screen.findByRole("heading", { name: "Журнал" });
    await user.click(within(screen.getByRole("group", { name: "Интервал записи журнала" })).getByRole("button", { name: "30 с" }));
    await user.click(screen.getByRole("link", { name: "События" }));
    expect(confirm).toHaveBeenCalledWith(LEAVE_TEXT);
    expect(path()).toBe("/settings/journal");
  });

  it("«Отмена» restores the saved values, then leaving does not ask", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const user = await setup();
    await user.click(threshold().getByRole("button", { name: "Увеличить" }));
    await user.click(button("Отмена"));
    expect(threshold().getByText("0,60")).toBeTruthy();
    expect(button("Отмена").disabled).toBe(true);
    expect(button("Сохранить").disabled).toBe(true);
    await user.click(screen.getByRole("link", { name: "Журнал" }));
    await screen.findByRole("heading", { name: "Журнал" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("«Сохранить» stores the draft, shows a toast, then leaving does not ask", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const user = await setup();
    await user.click(threshold().getByRole("button", { name: "Увеличить" }));
    await user.click(button("Сохранить"));
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings.mock.calls[0][0].events.negative_threshold).toBe(0.65);
    expect(toast).toHaveBeenCalledWith("Настройки сохранены");
    expect(button("Сохранить").disabled).toBe(true);
    await user.click(screen.getByRole("link", { name: "Журнал" }));
    await screen.findByRole("heading", { name: "Журнал" });
    expect(confirm).not.toHaveBeenCalled();
    expect(stored.events.negative_threshold).toBe(0.65);
  });

  it("a failed save keeps the draft and the guard", async () => {
    saveSettings.mockRejectedValue(new Error("HTTP 500"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = await setup();
    await user.click(threshold().getByRole("button", { name: "Увеличить" }));
    await user.click(button("Сохранить"));
    expect(await screen.findByText("Не удалось сохранить: HTTP 500")).toBeTruthy();
    expect(toast).not.toHaveBeenCalled();
    await user.click(screen.getByRole("link", { name: "Журнал" }));
    expect(confirm).toHaveBeenCalledWith(LEAVE_TEXT);
    expect(path()).toBe("/settings/events");
  });

  it("blocks tab close (beforeunload) only while there are changes", async () => {
    const user = await setup();
    const unload = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(unload()).toBe(false);
    await user.click(threshold().getByRole("button", { name: "Увеличить" }));
    expect(unload()).toBe(true);
    await user.click(button("Отмена"));
    expect(unload()).toBe(false);
  });
});
