import { useEffect } from "react";
import { useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { BoardPage } from "./components/BoardPage";
import { HomePage } from "./components/HomePage";
import { ArchivePage } from "./components/ArchivePage";
import { SettingsPage } from "./components/SettingsPage";
import { CardModal } from "./components/CardModal";
import { SearchPalette } from "./components/SearchPalette";
import { ConfirmHost } from "./components/ui";
import { ContextMenuHost } from "./components/ContextMenu";

export default function App() {
  const loaded = useStore((s) => s.loaded);
  const loadError = useStore((s) => s.loadError);
  const saveError = useStore((s) => s.saveError);
  const route = useStore((s) => s.route);
  const openCardId = useStore((s) => s.openCardId);
  const searchOpen = useStore((s) => s.searchOpen);
  const theme = useStore((s) => s.data.settings.theme);
  const boardExists = useStore((s) => route.page !== "board" || !!s.data.boards[route.boardId]);

  useEffect(() => {
    void useStore.getState().load();
  }, []);

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useStore.getState().setSearchOpen(!useStore.getState().searchOpen);
      }
    };
    // Hide the webview's own menu (Reload / Inspect…) except where text can be edited.
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("input, textarea, [contenteditable]")) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onCtx);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onCtx);
    };
  }, []);

  if (loadError)
    return (
      <div className="fatal">
        <h2>Couldn't read your data file</h2>
        <p>Nothing was overwritten. Fix or move the file, then restart Planwise.</p>
        <pre>{loadError}</pre>
      </div>
    );
  if (!loaded) return <div className="fatal muted">Loading…</div>;

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        {saveError && <div className="save-error">Saving failed: {saveError}</div>}
        {route.page === "home" && <HomePage />}
        {route.page === "board" && boardExists && <BoardPage key={route.boardId} boardId={route.boardId} />}
        {route.page === "board" && !boardExists && <HomePage />}
        {route.page === "archive" && <ArchivePage />}
        {route.page === "settings" && <SettingsPage />}
      </main>
      {openCardId && <CardModal cardId={openCardId} />}
      {searchOpen && <SearchPalette />}
      <ContextMenuHost />
      <ConfirmHost />
    </div>
  );
}
