import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, FolderPlus, Monitor, Plus, Server, Smartphone } from "lucide-react";
import { usePlaces, type PlaceBoard } from "../placeLists";
import { goToPhone, goToPlace } from "../places";
import { useStore } from "../store";

/**
 * Phones and tablets: the menu's boards, organized like OneNote. Each place is a big heading that
 * folds; inside it are its sections (categories) with their boards, then boards in no section, then
 * + Board and + Section.
 *
 *   ▾ This phone            (the place you're on: `here`, the usual board list, editable)
 *       ▾ Home Projects
 *           Board 1
 *   ▸ Computer              (another place: its boards as last seen; tap one to go there)
 */
export function PlaceSections({ here }: { here: ReactNode }) {
  const places = usePlaces();
  const [folded, setFolded] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("zomello-folded-places") ?? "[]");
    } catch {
      return [];
    }
  });
  const toggle = (key: string) => {
    const next = folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key];
    setFolded(next);
    try {
      localStorage.setItem("zomello-folded-places", JSON.stringify(next));
    } catch {
      /* not remembered, fine */
    }
  };

  // Until the lists load (a moment), show the place you're on as the only one.
  const me = places?.me ?? "phone";
  const all: { key: string; name: string; icon: ReactNode }[] = [
    { key: "phone", name: "This phone", icon: <Smartphone size={17} /> },
    ...(places?.list ?? []).map((p) => ({
      key: p.origin,
      name: p.kind === "computer" ? "Computer" : p.name,
      icon: p.kind === "computer" ? <Monitor size={17} /> : <Server size={17} />,
    })),
  ];
  if (!all.some((s) => s.key === me)) all.push({ key: me, name: location.hostname, icon: <Server size={17} /> });

  const go = (key: string, at?: string) =>
    key === "phone" ? goToPhone(at) : void goToPlace(key, null, at).catch((e) => useStore.getState().toast(String(e instanceof Error ? e.message : e)));

  return (
    <div className="place-sections">
      {all.map((p) => {
        const isHere = p.key === me;
        const open = !folded.includes(p.key);
        const saved = places?.boards[p.key];
        return (
          <section key={p.key} className={`place-section ${isHere ? "here" : ""}`}>
            <button className="place-head" onClick={() => toggle(p.key)} aria-expanded={open}>
              {p.icon}
              <span className="grow ellipsis">{p.name}</span>
              {!isHere && !open && <span className="count">{saved?.boards.length ?? 0}</span>}
              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {open &&
              (isHere ? (
                here
              ) : (
                <div className="nav-boards place-tree place-elsewhere">
                  <SavedTree
                    boards={saved?.boards ?? []}
                    sections={saved?.sections ?? []}
                    onOpen={(id) => go(p.key, `#/board/${id}`)}
                    onAddIn={(section) => go(p.key, `new-board:${section}`)}
                  />
                  {!saved && <p className="muted small place-empty">Open it once to see its boards here.</p>}
                  <div className="place-actions">
                    <button className="btn sm ghost" onClick={() => go(p.key, "new-board")}>
                      <Plus size={14} /> Board
                    </button>
                    <button className="btn sm ghost" onClick={() => go(p.key, "new-section")}>
                      <FolderPlus size={14} /> Section
                    </button>
                  </div>
                </div>
              ))}
          </section>
        );
      })}
    </div>
  );
}

/** Another place's boards, as last seen: its sections (folding here only), then boards in none. */
function SavedTree({
  boards,
  sections,
  onOpen,
  onAddIn,
}: {
  boards: PlaceBoard[];
  sections: string[];
  onOpen: (id: string) => void;
  onAddIn: (section: string) => void;
}) {
  const [shut, setShut] = useState<string[]>([]);
  const cats = [...new Set([...boards.map((b) => b.category), ...sections].filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
  const loose = boards.filter((b) => !b.category);
  const row = (b: PlaceBoard) => (
    <button key={b.id} className="nav-item" onClick={() => onOpen(b.id)}>
      <span className="board-dot" style={{ background: b.color }} />
      <span className="ellipsis label">{b.title}</span>
    </button>
  );
  return (
    <>
      {cats.map((c) => {
        const inCat = boards.filter((b) => b.category === c);
        const closed = shut.includes(c);
        return (
          <div key={c} className="nav-category">
            <div className="nav-category-row">
              <button className="nav-category-head" onClick={() => setShut(closed ? shut.filter((x) => x !== c) : [...shut, c])} aria-expanded={!closed}>
                {closed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                <span className="grow ellipsis">{c}</span>
                <span className="count">{inCat.length}</span>
              </button>
              <button className="icon-btn tiny" title={`New board in ${c}`} aria-label={`New board in ${c}`} onClick={() => onAddIn(c)}>
                <Plus size={14} />
              </button>
            </div>
            {!closed && inCat.map(row)}
            {!closed && inCat.length === 0 && <p className="muted small place-empty">No boards yet</p>}
          </div>
        );
      })}
      {loose.length > 0 && cats.length > 0 && <div className="place-subhead">Other boards</div>}
      {loose.map(row)}
    </>
  );
}
