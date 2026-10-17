import { useEffect, useState } from "react";
import { installOpenedFiles } from "./boardFile";
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
import { isServer, loadData as serverLoadData, RELOAD_EVENT, subscribe as serverSubscribe } from "./server";
import { useInvites } from "./invites";
import { AdminPage } from "./components/AdminPage";
import { ShareDialog } from "./components/ShareDialog";
import { inTauri } from "./storage";
import { installLongPressMenus, useIsPhone } from "./mobile";
import { installFileDropPolicy } from "./fileDrop";
import { installHistorySync } from "./routing";
import { ImportDialog } from "./components/ImportDialog";
import { DropOverlay } from "./components/DropOverlay";
import { AiDialog } from "./components/AiDialog";
import { ConnectionBanner, SecureBanner } from "./components/RemoteGate";
import { WelcomeGuide } from "./components/WelcomeGuide";

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
  const welcomeOpen = useStore((s) => s.welcomeOpen);
  const importOpen = useStore((s) => s.importOpen);
  const aiDialog = useStore((s) => s.aiDialog);
  const customizeBoard = useStore((s) => (s.customizeBoardId ? s.data.boards[s.customizeBoardId] : undefined));
  const shareBoard = useStore((s) => (s.shareBoardId ? s.data.boards[s.shareBoardId] : undefined));
  const settings = useStore((s) => s.data.settings);
  const boardExists = useStore((s) => route.page !== "board" || !!s.data.boards[route.boardId]);

  useEffect(() => {
    void useStore.getState().load();
  }, []);

  // Desktop app: turn the tray on if wanted. Started at login without it? Then show the window after all.
  useEffect(() => {
    if (!loaded || !inTauri || isBoardWindow) return;
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const bg = useStore.getState().data.settings.runInBackground;
      if (bg) await invoke("set_background_mode", { enabled: true }).catch(() => invoke("show_main_window"));
      else await invoke("show_main_window");
    })();
  }, [loaded]);

  useEffect(() => {
    // Reminders and the focus timer's alarm run in the main window only (no double notifications).
    if (!loaded || isBoardWindow || isRemote) return;
    const a = startReminders();
    const b = startFocusWatcher();
    return () => (a(), b());
  }, [loaded]);

  // Zomello Server: other people's changes, your other tabs, sharing changes and invitations.
  useEffect(() => {
    if (!loaded || !isServer) return;
    const reload = () => void serverLoadData().then((json) => useStore.getState().reloadFromServer(json)).catch(() => {});
    const off = serverSubscribe({
      ops: (ops) => useStore.getState().applyServerOps(ops),
      user: (doc) => useStore.getState().applyServerUserDoc(doc),
      reload,
      invites: () => void useInvites.getState().refresh(),
    });
    window.addEventListener(RELOAD_EVENT, reload);
    return () => {
      off();
      window.removeEventListener(RELOAD_EVENT, reload);
    };
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
  useEffect(() => (loaded && !isBoardWindow ? installOpenedFiles() : undefined), [loaded]);
  // The address bar follows the page and open card (Back button, refresh, bookmarks).
  useEffect(() => (loaded ? installHistorySync() : undefined), [loaded]);
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
    if (settings.style === "classic") delete root.dataset.style;
    else root.dataset.style = settings.style;
    if (settings.accent) root.style.setProperty("--accent", settings.accent);
    else root.style.removeProperty("--accent");
    root.style.fontSize = DENSITY[settings.density];
    // Accessibility switches become data-* attributes the stylesheet keys off.
    for (const [k, v] of Object.entries(settings.a11y)) root.toggleAttribute(`data-${k.toLowerCase()}`, v);
  }, [settings.theme, settings.style, settings.accent, settings.density, settings.a11y]);

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
        <SecureBanner />
        {/* On a phone, a dropped connection is retried automatically (the reconnect pill covers it). */}
        {saveError && !((isRemote || isServer) && /fetch|network|load failed/i.test(saveError)) && (
          <div className="save-error">Saving failed: {saveError}</div>
        )}
        <ErrorBoundary resetKey={route} onHome={() => useStore.getState().navigate({ page: "home" })}>
          {route.page === "home" && <HomePage />}
          {route.page === "mytasks" && <MyTasksPage />}
          {route.page === "board" && boardExists && <BoardPage key={route.boardId} boardId={route.boardId} />}
          {route.page === "board" && !boardExists && <HomePage />}
          {route.page === "archive" && <ArchivePage />}
          {route.page === "settings" && <SettingsPage />}
          {route.page === "admin" && <AdminPage />}
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
      {shareBoard && <ShareDialog board={shareBoard} onClose={() => useStore.getState().setOverlay({ shareBoardId: null })} />}
      {helpOpen && <HelpWindow />}
      {(welcomeOpen || (!settings.onboarded && !isBoardWindow && !isRemote)) && (
        <WelcomeGuide onClose={() => useStore.getState().setOverlay({ welcomeOpen: false })} />
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
      <button className="phone-bar-home grow" onClick={() => useStore.getState().navigate({ page: "home" })} aria-label="Home">
        <LogoMark size={26} />
        <span className="phone-bar-title">Zomello</span>
      </button>
      <button className="icon-btn" onClick={() => setSearchOpen(true)} aria-label="Search">
        <Search size={19} />
      </button>
      <button className="icon-btn" onClick={() => setOverlay({ quickAddOpen: true })} aria-label="Quick add">
        <Plus size={20} />
      </button>
    </header>
  );
}

/** Help: the welcome guide again, the basics at a glance, and every keyboard shortcut. */
function HelpWindow() {
  const close = () => useStore.getState().setOverlay({ helpOpen: false });
  return (
    <Modal onClose={close} width={760} className="help">
      <header className="customize-head">
        <h2>Help</h2>
        <button className="icon-btn" onClick={close}>
          <X size={18} />
        </button>
      </header>
      <div className="customize-body">
        <div className="help-start">
          <div>
            <b>New here, or need a refresher?</b>
            <p className="muted small">A one-minute tour of boards, buckets, cards and the essentials.</p>
          </div>
          <button
            className="btn primary"
            onClick={() => {
              close();
              useStore.getState().setOverlay({ welcomeOpen: true });
            }}
          >
            Show the welcome guide
          </button>
        </div>
        <h3 className="help-h">Good to know</h3>
        <ul className="help-faq">
          <li>
            <b>Where did my completed card go?</b> It's tucked under <i>Show completed</i> at the bottom of its bucket. Buckets
            set to complete their cards (like Done) show them instead; change that from the bucket's ⋯ menu.
          </li>
          <li>
            <b>Deleted something by mistake?</b> Press Ctrl+Z, or Undo on the message that pops up. Archived things are under
            Archive in the sidebar.
          </li>
          <li>
            <b>Where is my data?</b> In one file on this computer, saved as you type, with automatic backups every 30
            minutes. Settings → Data shows where, and can export or restore it.
          </li>
          <li>
            <b>Use it on a phone or tablet?</b> Settings → Phones &amp; tablets walks you through it.
          </li>
          <li>
            <b>Select several cards?</b> Ctrl+click (or Shift+click) them, then use the bar that appears.
          </li>
        </ul>
        <h3 className="help-h">Keyboard shortcuts</h3>
        <ShortcutList />
      </div>
    </Modal>
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
          {t.action && (
            <button
              className="btn sm"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
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
