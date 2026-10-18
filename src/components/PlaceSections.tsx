import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRightLeft, ChevronDown, ChevronRight, Copy, ExternalLink, FolderPlus, Monitor, Plus, Server, Smartphone } from "lucide-react";
import { DndContext, useDraggable, type DragEndEvent, type DragMoveEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { useDragSensors } from "../mobile";
import { openContextMenu, type MenuEntry } from "./ContextMenu";
import { askChoice } from "./ui";
import { relaySend } from "../transfer";
import { usePlaces, type PlaceBoard } from "../placeLists";
import { goToPhone, goToPlace } from "../places";
import { useStore } from "../store";
import { deviceWord, isMobileApp } from "../storage";

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
    { key: "phone", name: `This ${deviceWord}`, icon: <Smartphone size={17} /> },
    ...(places?.list ?? []).map((p) => ({
      key: p.origin,
      name: p.kind === "computer" ? "Computer" : p.name,
      icon: p.kind === "computer" ? <Monitor size={17} /> : <Server size={17} />,
    })),
  ];
  if (!all.some((s) => s.key === me)) all.push({ key: me, name: location.hostname, icon: <Server size={17} /> });

  const go = (key: string, at?: string) =>
    key === "phone" ? goToPhone(at) : void goToPlace(key, null, at).catch((e) => useStore.getState().toast(String(e instanceof Error ? e.message : e)));

  // A board from another place's part of the menu can go to this place, or (from the phone) anywhere.
  const targets = (from: string) => all.filter((p) => p.key !== from && (from === "phone" || p.key === "phone" || (p.key === me && me === "phone")));
  const send = async (from: string, board: PlaceBoard, to: { key: string; name: string }, ask = true) => {
    const pick = ask ? await askChoice(`Move “${board.title}” to ${to.name}? Or keep it where it is and put a copy there.`, "Move", "Copy") : "ok";
    if (pick) void relaySend(from, board.id, to.key, pick === "ok");
  };
  const menuFor = (from: string, board: PlaceBoard): MenuEntry[] => [
    { label: "Open", icon: <ExternalLink size={14} />, onClick: () => go(from, `#/board/${board.id}`) },
    { separator: true },
    ...targets(from).flatMap((t): MenuEntry[] => [
      { label: `Move to ${t.name}`, icon: <ArrowRightLeft size={14} />, onClick: () => void relaySend(from, board.id, t.key, true) },
      { label: `Copy to ${t.name}`, icon: <Copy size={14} />, onClick: () => void relaySend(from, board.id, t.key, false) },
    ]),
  ];
  const sensors = useDragSensors(5);
  const dropTarget = (e: DragMoveEvent | DragEndEvent) => {
    const from = String(e.active.id).split("\n")[0];
    const el = pointAt(e)?.closest<HTMLElement>("[data-place-key]");
    const key = el?.dataset.placeKey;
    return key && targets(from).some((t) => t.key === key) ? el! : undefined;
  };
  const mark = (el?: HTMLElement) => {
    document.querySelectorAll(".place-section.drop-into").forEach((n) => n !== el && n.classList.remove("drop-into"));
    el?.classList.add("drop-into");
  };

  return (
    <DndContext
      sensors={sensors}
      modifiers={[restrictToVerticalAxis]}
      onDragMove={(e) => mark(dropTarget(e))}
      onDragCancel={() => mark()}
      onDragEnd={(e) => {
        const el = dropTarget(e);
        mark();
        if (!el) return;
        const [from, id] = String(e.active.id).split("\n");
        const board = places?.boards[from]?.boards.find((b) => b.id === id);
        const to = all.find((p) => p.key === el.dataset.placeKey);
        if (board && to) void send(from, board, to);
      }}
    >
    <div className="place-sections">
      {all.map((p) => {
        const isHere = p.key === me;
        const open = !folded.includes(p.key);
        const saved = places?.boards[p.key];
        return (
          <section key={p.key} className={`place-section ${isHere ? "here" : ""}`} data-place-key={p.key}>
            <button
              className="place-head"
              onClick={() => toggle(p.key)}
              aria-expanded={open}
              // Another place: drop a board here to move or copy it there. (A computer's or server's
              // page can only hand boards back to the phone.)
              data-place={isHere || (!isMobileApp && p.key !== "phone") ? undefined : p.key}
              data-place-name={p.name}
            >
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
                    place={p.key}
                    boards={saved?.boards ?? []}
                    sections={saved?.sections ?? []}
                    onOpen={(id) => go(p.key, `#/board/${id}`)}
                    onMenu={(e, b) => openContextMenu(e, () => menuFor(p.key, b))}
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
    </DndContext>
  );
}

/** The element under the pointer during a drag (it started on the row and moved by `delta`). */
function pointAt(e: { activatorEvent: Event | null; delta: { x: number; y: number } }): Element | null {
  const start = e.activatorEvent as (MouseEvent & TouchEvent) | null;
  if (!start) return null;
  const p = start.touches?.[0] ?? start.changedTouches?.[0] ?? start;
  return document.elementFromPoint(p.clientX, p.clientY + e.delta.y);
}

/** A board in another place's part of the menu: tap to open it there, hold to drag it to another place. */
function SavedRow({ place, board, onOpen, onMenu }: { place: string; board: PlaceBoard; onOpen: () => void; onMenu: (e: React.MouseEvent) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `${place}\n${board.id}` });
  // Letting go after a drag also "clicks" the row; that click shouldn't open the board.
  const dragged = useRef(false);
  useEffect(() => {
    if (isDragging) dragged.current = true;
  }, [isDragging]);
  return (
    <button
      ref={setNodeRef}
      className={`nav-item ${isDragging ? "dragging" : ""}`}
      style={transform ? { transform: `translateY(${transform.y}px)`, position: "relative", zIndex: 5 } : undefined}
      onClick={() => {
        if (dragged.current) dragged.current = false;
        else onOpen();
      }}
      onContextMenu={onMenu}
      {...attributes}
      {...listeners}
    >
      <span className="board-dot" style={{ background: board.color }} />
      <span className="ellipsis label">{board.title}</span>
    </button>
  );
}

/** Another place's boards, as last seen: its sections (folding here only), then boards in none. */
function SavedTree({
  place,
  boards,
  sections,
  onOpen,
  onMenu,
  onAddIn,
}: {
  place: string;
  boards: PlaceBoard[];
  sections: string[];
  onOpen: (id: string) => void;
  onMenu: (e: React.MouseEvent, b: PlaceBoard) => void;
  onAddIn: (section: string) => void;
}) {
  const [shut, setShut] = useState<string[]>([]);
  const cats = [...new Set([...boards.map((b) => b.category), ...sections].filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
  const loose = boards.filter((b) => !b.category);
  const row = (b: PlaceBoard) => <SavedRow key={b.id} place={place} board={b} onOpen={() => onOpen(b.id)} onMenu={(e) => onMenu(e, b)} />;
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
