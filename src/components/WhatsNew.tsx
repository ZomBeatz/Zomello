import type { ReactNode } from "react";
import { create } from "zustand";
import { Flag, LayoutTemplate, Shuffle, Sparkles, Users } from "lucide-react";
import { useStore } from "../store";
import { logLine } from "../logs";
import { openExternal } from "../storage";
import { copyText } from "./Markdown";
import { Modal } from "./ui";

/**
 * "New in Zomello": a short note shown once after updating to a new version (a 0.x release), with the few
 * things worth trying. Update WHATS_NEW for each release; the full list is the guide's What's new page.
 */
export const WHATS_NEW: { version: string; items: { icon: ReactNode; title: string; text: string; action?: { label: string; run: () => void } }[] } = {
  version: "0.7",
  items: [
    {
      icon: <Users size={18} />,
      title: "Share boards with the people at home",
      text: "Give a linked phone to someone, then choose which boards they see and whether they can view, tick off their own tasks, or edit. Find it in a board's menu: People on this board.",
    },
    {
      icon: <Shuffle size={18} />,
      title: "Auto-assign",
      text: "A bucket can hand its cards to whoever has the most room, most important first, and queue the rest. Turn it on in a bucket's rules.",
    },
    {
      icon: <Flag size={18} />,
      title: "Your own priorities",
      text: "Rename, recolor and add priorities per board, with an icon and a colored card edge. Customize > Priorities.",
    },
    {
      icon: <LayoutTemplate size={18} />,
      title: "Start a board your way",
      text: "New boards start blank with one To do bucket, or pick a layout or template under Start with, including a new shopping list.",
      action: { label: "Go to Home", run: () => useStore.getState().navigate({ page: "home" }) },
    },
  ],
};

const GUIDE_WHATS_NEW = "https://docs.zombeatzmedia.com/zomello/whats-new";

export const useWhatsNew = create<{ open: boolean }>(() => ({ open: false }));
export const openWhatsNew = () => useWhatsNew.setState({ open: true });

/** This version has a note, and it hasn't been seen on this account yet. */
export const whatsNewDue = (seen: string | undefined) => seen !== WHATS_NEW.version && __APP_VERSION__.startsWith(`${WHATS_NEW.version}.`);

/** Opens the guide's full list. If the browser doesn't open, say so and offer the link instead of doing nothing. */
function seeEverything(close: () => void) {
  close();
  openExternal(GUIDE_WHATS_NEW).catch((e) => {
    logLine("warn", `What's new: couldn't open the guide: ${String(e)}`);
    useStore.getState().toast("Couldn't open your browser.", { action: { label: "Copy link", run: () => void copyText(GUIDE_WHATS_NEW, "Link copied.") } });
  });
}

export function WhatsNew() {
  const close = () => {
    useWhatsNew.setState({ open: false });
    useStore.getState().updateSettings({ seenWhatsNew: WHATS_NEW.version });
  };
  return (
    <Modal onClose={close} width={520} className="whats-new">
      <header className="whats-new-head">
        <Sparkles size={20} />
        <h2>New in Zomello {WHATS_NEW.version}</h2>
      </header>
      <ul className="whats-new-list">
        {WHATS_NEW.items.map((it) => (
          <li key={it.title}>
            <span className="whats-new-icon">{it.icon}</span>
            <div>
              <b>{it.title}</b>
              <p className="muted">{it.text}</p>
              {it.action && (
                <button
                  className="btn sm"
                  onClick={() => {
                    close();
                    it.action!.run();
                  }}
                >
                  {it.action.label}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="row end gap whats-new-foot">
        <button className="btn ghost" onClick={() => seeEverything(close)}>
          See everything new
        </button>
        <button className="btn primary" onClick={close}>
          Got it
        </button>
      </div>
    </Modal>
  );
}
