// App frame: toolbar, health banner, routed screen, add-stream dialog. Streams layout adds the sidebar.
import { useEffect } from "react";
import { Outlet } from "react-router";
import { appData } from "../state/appData";
import AddStreamDialog from "../streams/AddStreamDialog";
import Sidebar from "../streams/Sidebar";
import { useShell } from "./context";
import { HealthBannerView } from "./health";
import Toolbar from "./Toolbar";

export default function Layout() {
  const { health, healthError, addStreamOpen } = useShell();
  useEffect(() => {
    appData.start();
    return () => appData.stop();
  }, []);
  return (
    <div className="app">
      <Toolbar />
      <HealthBannerView health={health} error={healthError} />
      <Outlet />
      {addStreamOpen && <AddStreamDialog />}
    </div>
  );
}

export function SidebarLayout() {
  return (
    <div className="with-sidebar">
      <Sidebar />
      <Outlet />
    </div>
  );
}
