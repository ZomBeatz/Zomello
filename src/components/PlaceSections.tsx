import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Monitor, Plus, Server, Smartphone } from "lucide-react";
import { usePlaces, type PlaceBoard } from "../placeLists";
import { goToPhone, goToPlace } from "../places";
import { useStore } from "../store";

/**
 * Phones and tablets: the menu's boards, one folding section per place.
 *
 *   ▾ This phone          (the place you're on: its boards, categories, + New board)
 *   ▸ My computer         (another place: its boards as last seen; tap one to go there)
 *
 * `here` is the usual board list of the place you're on.
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

  // Until the lists load (a moment), show the place you're on as the only section.
  const me = places?.me ?? "phone";
  const sections: { key: string; name: string; icon: ReactNode }[] = [
    { key: "phone", name: "This phone", icon: <Smartphone size={15} /> },
    ...(places?.list ?? []).map((p) => ({
      key: p.origin,
      name: p.name,
      icon: p.kind === "computer" ? <Monitor size={15} /> : <Server size={15} />,
    })),
  ];
  if (!sections.some((s) => s.key === me)) sections.push({ key: me, name: location.hostname, icon: <Server size={15} /> });

  const go = (key: string, at?: string) => (key === "phone" ? goToPhone(at) : void goToPlace(key, null, at).catch((e) => useStore.getState().toast(String(e instanceof Error ? e.message : e))));

  return (
    <div className="place-sections">
      {sections.map((s) => {
        const isHere = s.key === me;
        const open = !folded.includes(s.key);
        const saved = places?.boards[s.key]?.boards ?? [];
        return (
          <section key={s.key} className={`place-section ${isHere ? "here" : ""}`}>
            <div className="place-head">
              <button className="place-fold" onClick={() => toggle(s.key)} aria-expanded={open} aria-label={open ? `Fold ${s.name}` : `Show ${s.name}`}>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {/* The place you're on folds; another place's name takes you there. */}
              <button className="place-name" onClick={() => (isHere ? toggle(s.key) : go(s.key, "#/home"))} title={isHere ? undefined : `Go to ${s.name}`}>
                {s.icon}
                <span className="grow ellipsis">{s.name}</span>
                {!isHere && <span className="count">{saved.length}</span>}
              </button>
            </div>
            {open &&
              (isHere ? (
                here
              ) : (
                <div className="nav-boards place-elsewhere">
                  <SavedBoards boards={saved} onOpen={(id) => go(s.key, `#/board/${id}`)} />
                  {saved.length === 0 && <p className="muted small place-empty">Open it once to see its boards here.</p>}
                  <button className="nav-item nav-new-board" onClick={() => go(s.key, "new-board")}>
                    <Plus size={15} />
                    <span className="label">New board</span>
                  </button>
                </div>
              ))}
          </section>
        );
      })}
    </div>
  );
}

/** Another place's boards: loose ones first, then each category (as on that place). */
function SavedBoards({ boards, onOpen }: { boards: PlaceBoard[]; onOpen: (id: string) => void }) {
  const cats = [...new Set(boards.map((b) => b.category).filter((c): c is string => !!c))];
  const row = (b: PlaceBoard) => (
    <button key={b.id} className="nav-item" onClick={() => onOpen(b.id)}>
      <span className="board-dot" style={{ background: b.color }} />
      <span className="ellipsis label">{b.title}</span>
    </button>
  );
  return (
    <>
      {boards.filter((b) => !b.category).map(row)}
      {cats.map((c) => (
        <div key={c} className="nav-category">
          <div className="nav-category-head static">
            <span className="grow ellipsis">{c}</span>
            <span className="count">{boards.filter((b) => b.category === c).length}</span>
          </div>
          {boards.filter((b) => b.category === c).map(row)}
        </div>
      ))}
    </>
  );
}
