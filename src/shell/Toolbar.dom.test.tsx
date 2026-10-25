// @vitest-environment jsdom
// Toolbar menus (ui.md Routes and menus): click opens, another menu button switches, a second click on
// the same button, an outside click, Esc or choosing an item closes.
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import Toolbar from "./Toolbar";

const setAddStreamOpen = vi.hoisted(() => vi.fn());
vi.mock("./context", () => ({ useShell: () => ({ setAddStreamOpen }) }));

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function setup(path = "/streams") {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <>
            <Toolbar />
            <p>Содержимое страницы</p>
            <Where />
          </>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}

const menuButton = (name: string) => screen.getByRole("button", { name });
const openMenu = () => screen.queryByRole("menu");
const where = () => screen.getByTestId("where").textContent;

afterEach(() => {
  cleanup();
  setAddStreamOpen.mockReset();
});

describe("Toolbar menus", () => {
  it("opens a menu on click and closes it on a second click", async () => {
    const user = setup();
    expect(openMenu()).toBeNull();
    await user.click(menuButton("Потоки"));
    expect(menuButton("Потоки").getAttribute("aria-expanded")).toBe("true");
    expect(within(openMenu()!).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Все потоки", "Веб-камера", "Добавить поток"]);
    await user.click(menuButton("Потоки"));
    expect(openMenu()).toBeNull();
    expect(menuButton("Потоки").getAttribute("aria-expanded")).toBe("false");
  });

  it("switches to another menu when its button is clicked", async () => {
    const user = setup();
    await user.click(menuButton("Потоки"));
    await user.click(menuButton("История"));
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(within(openMenu()!).getByRole("menuitem", { name: "Журнал событий" })).toBeTruthy();
    expect(menuButton("Потоки").getAttribute("aria-expanded")).toBe("false");
    expect(menuButton("История").getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on an outside click", async () => {
    const user = setup();
    await user.click(menuButton("Настройки"));
    expect(openMenu()).not.toBeNull();
    await user.click(screen.getByText("Содержимое страницы"));
    expect(openMenu()).toBeNull();
    expect(where()).toBe("/streams");
  });

  it("closes on Esc", async () => {
    const user = setup();
    await user.click(menuButton("Анализ видео"));
    expect(openMenu()).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(openMenu()).toBeNull();
  });

  it("choosing an item closes the menu and navigates", async () => {
    const user = setup();
    await user.click(menuButton("История"));
    await user.click(screen.getByRole("menuitem", { name: "Сеансы и экспорт" }));
    expect(openMenu()).toBeNull();
    expect(where()).toBe("/history/sessions");
    await user.click(menuButton("Анализ видео"));
    await user.click(screen.getByRole("menuitem", { name: "Загрузить запись" }));
    expect(openMenu()).toBeNull();
    expect(where()).toBe("/analyze?upload=1");
  });

  it("«Добавить поток» goes to the streams screen and opens the dialog", async () => {
    const user = setup("/history/events");
    await user.click(menuButton("Потоки"));
    await user.click(screen.getByRole("menuitem", { name: "Добавить поток" }));
    expect(openMenu()).toBeNull();
    expect(where()).toBe("/streams");
    expect(setAddStreamOpen).toHaveBeenCalledWith(true);
  });

  it("the bell shares the toolbar's single open menu", async () => {
    const user = setup("/streams");
    const bell = screen.getByRole("button", { name: /^Уведомления/ });
    await user.click(menuButton("Потоки"));
    await user.click(bell);
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(screen.getByText("Новых инцидентов нет")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(openMenu()).toBeNull();
  });

  it("shows the bell only on the streams and live screens", () => {
    setup("/settings/events");
    expect(screen.queryByRole("button", { name: /^Уведомления/ })).toBeNull();
  });
});
