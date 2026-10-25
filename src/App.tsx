// Router and screen map (ui.md Routes and menus).
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import AnalyzePage from "./analyze/AnalyzePage";
import EventsJournal from "./history/EventsJournal";
import SessionsPage from "./history/SessionsPage";
import LiveView from "./live/LiveView";
import SettingsPage from "./settings/SettingsPage";
import { ShellProvider } from "./shell/context";
import Layout, { SidebarLayout } from "./shell/Layout";
import Grid from "./streams/Grid";
import StreamDetail from "./streams/StreamDetail";

export const routes = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/streams" replace /> },
      {
        element: <SidebarLayout />,
        children: [
          { path: "streams", element: <Grid /> },
          { path: "streams/:id", element: <StreamDetail /> },
          { path: "live", element: <LiveView /> },
        ],
      },
      { path: "history", element: <Navigate to="/history/events" replace /> },
      { path: "history/events", element: <EventsJournal /> },
      { path: "history/sessions", element: <SessionsPage /> },
      { path: "settings", element: <Navigate to="/settings/events" replace /> },
      { path: "settings/:tab", element: <SettingsPage /> },
      { path: "analyze/:sessionId?", element: <AnalyzePage /> },
      { path: "*", element: <Navigate to="/streams" replace /> },
    ],
  },
];

const router = createBrowserRouter(routes);

export default function App() {
  return (
    <ShellProvider>
      <RouterProvider router={router} />
    </ShellProvider>
  );
}
