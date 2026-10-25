// `/history/sessions` (CAP-4): the existing sessions list on its own screen.
import SessionsView from "../sessions/SessionsView";

export default function SessionsPage() {
  return (
    <main className="content page">
      <SessionsView />
    </main>
  );
}
