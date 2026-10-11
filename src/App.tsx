import { useEffect, useState } from "react";
import { Menu, Plus, Search, X } from "lucide-react";
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
import { isBoardWindow, onOtherWindowData, setWindowTitle } from "./windows";
import { isRemote } from "./remote";
import { installLongPressMenus, useIsPhone } from "./mobile";
import { installFileDropPolicy } from "./fileDrop";
import { ImportDialog } from "./components/ImportDialog";
import { DropOverlay } from "./components/DropOverlay";
import { AiDialog } from "./components/AiDialog";
import { ConnectionBanner } from "./components/RemoteGate";

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
  const aiDialog = useStore((s) => s.aiDialog);
  const customizeBoard = useStore((s) => (s.customizeBoardId ? s.data.boards[s.customizeBoardId] : undefined));
  const settings = useStore((s) => s.data.settings);
  const boardExists = useStore((s) => route.page !== "board" || !!s.data.boards[route.boardId]);

  useEffect(() => {
    void useStore.getState().load();
  }, []);

  useEffect(() => {
    // Reminders and the focus timer's alarm run in the main window only (no double notifications).
    if (!loaded || isBoardWindow || isRemote) return;
    const a = startReminders();
    const b = startFocusWatcher();
    return () => (a(), b());
  }, [loaded]);

  // Other windows' saves (board windows ↔ main window).
  useEffect(() => onOtherWindowData((json) => useStore.getState().loaded && useStore.getState().applyRemoteData(json)), []);
  // The focus countdown lives in shared local storage; follow changes made in other windows.
  useEffect(() => {
    const h = (e: StorageEvent) => {
      if (e.key !== "zomello-focus") return;
      try {
        useStore.setState({ focus: e.newValue ? JSON.parse(e.newValue) : null });
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);

  // Board windows are titled after their board.
  const windowTitle = useStore((s) =>
    isBoardWindow && s.route.page === "board" ? `${s.data.boards[s.route.boardId]?.title ?? "Board"} — Zomello` : "Zomello",
  );
  useEffect(() => {
    if (isBoardWindow) void setWindowTitle(windowTitle);
  }, [windowTitle]);

  useEffect(() => installFileDropPolicy(), []);
  // Touch screens: press and hold opens the right-click menus.
  useEffect(() => (navigator.maxTouchPoints > 0 ? installLongPressMenus() : undefined), []);

  const phone = useIsPhone();
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [route, phone]);


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
    // Zoom is the PC's setting; phones and tablets pinch-zoom on their own.
    void applyZoom(isRemote ? 1 : settings.zoom);
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
    <div className={`app ${phone ? "phone" : ""} ${navOpen ? "nav-open" : ""}`}>
      <Sidebar />
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
      <main className="main">
        {phone && <PhoneBar onMenu={() => setNavOpen(true)} />}
        <ConnectionBanner />
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
      {aiDialog && <AiDialog init={aiDialog} />}
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
      <DropOverlay />
      <Toasts />
      <ContextMenuHost />
      <ConfirmHost />
    </div>
  );
}

/** Top bar on phone-sized screens: opens the sidebar drawer, search and quick add. */
function PhoneBar({ onMenu }: { onMenu: () => void }) {
  const { setSearchOpen, setOverlay } = useStore.getState();
  return (
    <header className="phone-bar">
      <button className="icon-btn" onClick={onMenu} aria-label="Menu">
        <Menu size={20} />
      </button>
      <LogoMark size={24} />
      <span className="phone-bar-title grow">Zomello</span>
      <button className="icon-btn" onClick={() => setSearchOpen(true)} aria-label="Search">
        <Search size={19} />
      </button>
      <button className="icon-btn" onClick={() => setOverlay({ quickAddOpen: true })} aria-label="Quick add">
        <Plus size={20} />
      </button>
    </header>
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
