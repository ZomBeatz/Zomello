import { useEffect } from "react";
import { X } from "lucide-react";
import { useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { BoardPage } from "./components/BoardPage";
import { HomePage } from "./components/HomePage";
import { MyTasksPage } from "./components/MyTasksPage";
import { ArchivePage } from "./components/ArchivePage";
import { ShortcutList, SettingsPage } from "./components/SettingsPage";
import { CardModal } from "./components/CardModal";
import { SearchPalette } from "./components/SearchPalette";
import { QuickAdd } from "./components/QuickAdd";
import { BoardCustomize } from "./components/BoardCustomize";
import { ConfirmHost, Modal } from "./components/ui";
import { ContextMenuHost } from "./components/ContextMenu";
import { LogoMark } from "./components/Logo";
import { handleShortcut } from "./shortcuts";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { startReminders } from "./reminders";
import { applyZoom, installZoomControls } from "./zoom";
import { startFocusWatcher } from "./focus";
import { installFileDropPolicy } from "./fileDrop";
import { ImportDialog } from "./components/ImportDialog";

const DENSITY = { compact: "13px", normal: "14px", comfortable: "15.5px" };

export default function App() {
  const loaded = useStore((s) => s.loaded);
  const loadError = useStore((s) => s.loadError);
  const saveError = useStore((s) => s.saveError);
  const route = useStore((s) => s.route);
  const openCardId = useStore((s) => s.openCardId);
  const searchOpen = useStore((s) => s.searchOpen);
  const quickAddOpen = useStore((s) => s.quickAddOpen);
  const helpOpen = useStore((s) => s.helpOpen);
  const importOpen = useStore((s) => s.importOpen);
  const customizeBoard = useStore((s) => (s.customizeBoardId ? s.data.boards[s.customizeBoardId] : undefined));
  const settings = useStore((s) => s.data.settings);
  const boardExists = useStore((s) => route.page !== "board" || !!s.data.boards[route.boardId]);

  useEffect(() => {
    void useStore.getState().load();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const a = startReminders();
    const b = startFocusWatcher();
    return () => (a(), b());
  }, [loaded]);

  useEffect(() => installFileDropPolicy(), []);

  // Theme, accent color and density live on <html> so every component picks them up.
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "system") delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
    if (settings.accent) root.style.setProperty("--accent", settings.accent);
    else root.style.removeProperty("--accent");
    root.style.fontSize = DENSITY[settings.density];
    // Accessibility switches become data-* attributes the stylesheet keys off.
    for (const [k, v] of Object.entries(settings.a11y)) root.toggleAttribute(`data-${k.toLowerCase()}`, v);
  }, [settings.theme, settings.accent, settings.density, settings.a11y]);

  useEffect(() => {
    void applyZoom(settings.zoom);
  }, [settings.zoom]);

  useEffect(() => installZoomControls(), []);

  useEffect(() => {
    // Hide the webview's own menu (Reload / Inspect…) except where text can be edited.
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("input, textarea, [contenteditable]")) e.preventDefault();
    };
    window.addEventListener("keydown", handleShortcut);
    window.addEventListener("contextmenu", onCtx);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      window.removeEventListener("contextmenu", onCtx);
    };
  }, []);

  if (loadError)
    return (
      <div className="fatal">
        <h2>Couldn't read your data file</h2>
        <p>Nothing was overwritten. Fix or move the file, then restart Zomello.</p>
        <pre>{loadError}</pre>
      </div>
    );
  if (!loaded)
    return (
      <div className="splash">
        <LogoMark size={72} />
      </div>
    );

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        {saveError && <div className="save-error">Saving failed: {saveError}</div>}
        <ErrorBoundary resetKey={route} onHome={() => useStore.getState().navigate({ page: "home" })}>
          {route.page === "home" && <HomePage />}
          {route.page === "mytasks" && <MyTasksPage />}
          {route.page === "board" && boardExists && <BoardPage key={route.boardId} boardId={route.boardId} />}
          {route.page === "board" && !boardExists && <HomePage />}
          {route.page === "archive" && <ArchivePage />}
          {route.page === "settings" && <SettingsPage />}
        </ErrorBoundary>
      </main>
      {openCardId && (
        <ErrorBoundary resetKey={openCardId} onHome={() => useStore.getState().openCard(null)}>
          <CardModal cardId={openCardId} />
        </ErrorBoundary>
      )}
      {searchOpen && <SearchPalette />}
      {quickAddOpen && <QuickAdd />}
      {importOpen && <ImportDialog />}
      {customizeBoard && <BoardCustomize board={customizeBoard} />}
      {helpOpen && (
        <Modal onClose={() => useStore.getState().setOverlay({ helpOpen: false })} width={760} className="help">
          <header className="customize-head">
            <h2>Keyboard shortcuts</h2>
            <button className="icon-btn" onClick={() => useStore.getState().setOverlay({ helpOpen: false })}>
              <X size={18} />
            </button>
          </header>
          <div className="customize-body">
            <ShortcutList />
          </div>
        </Modal>
      )}
      <Toasts />
      <ContextMenuHost />
      <ConfirmHost />
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const { dismissToast, undo } = useStore.getState();
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className="grow">{t.text}</span>
          {t.undo && (
            <button
              className="btn sm"
              onClick={() => {
                undo();
                dismissToast(t.id);
              }}
            >
              Undo
            </button>
          )}
          <button className="icon-btn tiny" onClick={() => dismissToast(t.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
