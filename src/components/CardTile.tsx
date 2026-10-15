import { memo } from "react";
import { differenceInCalendarDays } from "date-fns";
import {
  AlignLeft, Ban, Calendar, CheckSquare, CornerDownRight, Flag, Link2, ListTree, MessageSquare, Octagon, Paperclip, Repeat, Timer,
} from "lucide-react";
import type { Board, Card, ID } from "../types";
import { useStore } from "../store";
import {
  agingLevel, checklistStats, describeRecurrence, dueStatus, formatDuration, formatFieldValue, fromISO, isBlocked,
  parentIndex, plainText, prettyDate, priorityMeta, subtaskIds, timeAgo, trackedMs,
} from "../utils";
import { storedSrc } from "../storage";
import { Avatar, PriorityBadge, ProgressIcon } from "./ui";
import { openCardMenu } from "./ContextMenu";
import { clearHoverLinks, hoverLinks, useLinkHover } from "../linkHover";

/** Tag shown on a card while a connected card is hovered: how it relates to the hovered card. */
const REL_LABEL = {
  parent: "Parent",
  child: "Sub-task",
  blocker: "Blocks it",
  blocked: "Blocked by it",
  related: "Related",
} as const;

/** The card under the mouse, for hover keyboard shortcuts (see shortcuts.ts). */
export let hoveredCardId: ID | null = null;

function relativeDue(c: Card): string {
  if (!c.dueDate) return "";
  const d = differenceInCalendarDays(fromISO(c.dueDate), new Date());
  if (c.progress === "completed") return "done";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "1 day late";
  return d < 0 ? `${-d} days late` : `in ${d} days`;
}

export const CardTile = memo(function CardTile({
  card,
  board,
  bucketName,
  dragging,
}: {
  card: Card;
  board: Board;
  /** Shown when the board isn't grouped by bucket. */
  bucketName?: string;
  dragging?: boolean;
}) {
  const openCard = useStore((s) => s.openCard);
  const updateCard = useStore((s) => s.updateCard);
  const toggleChecklistItem = useStore((s) => s.toggleChecklistItem);
  const blocked = useStore((s) => card.progress !== "completed" && isBlocked(card, s.data.cards));
  const linkedTitles = useStore((s) =>
    board.display.badges.links === "full"
      ? card.links
          .map((l) => s.data.cards[l.cardId] && `${l.type === "blocks" ? "Blocks" : l.type === "blockedBy" ? "Blocked by" : "Related"}: ${s.data.cards[l.cardId].title}`)
          .filter(Boolean)
          .join("\n")
      : "",
  );
  // Cards that have this one as a sub-task (newline-joined titles, so the selector stays cheap to compare).
  const parentTitles = useStore((s) => (parentIndex(s.data.cards).get(card.id) ?? []).map((p) => p.title).join("\n"));
  const linkRole = useLinkHover((s) => s.roles[card.id]);
  const selected = useStore((s) => s.selected.includes(card.id));
  const isLinkSource = useLinkHover((s) => s.source === card.id);
  const subIds = subtaskIds(card);
  const subDone = card.checklist.filter((i) => i.cardId && i.done).length;
  const relCount = (t: string) => card.links.filter((l) => l.type === t).length;
  // The bucket can override the board's "Show on cards" settings.
  const listBadges = useStore((s) => s.data.lists[card.listId]?.badges);
  const mode = listBadges ? { ...board.display.badges, ...listBadges } : board.display.badges;
  const labels = board.labels.filter((l) => card.labelIds.includes(l.id));
  const cl = checklistStats(card);
  // The bucket can override the board's "hide ticked items on cards".
  const listHide = useStore((s) => s.data.lists[card.listId]?.hideChecked);
  const hideChecked = listHide ?? !!board.display.hideChecked;
  const shownItems = hideChecked ? card.checklist.filter((i) => !i.done) : card.checklist;
  const hiddenDone = card.checklist.length - shownItems.length;
  const due = dueStatus(card);
  const done = card.progress === "completed";
  const running = card.time.some((t) => t.end === null);
  const tracked = trackedMs(card);
  const coverImg = card.coverImage ? card.attachments.find((a) => a.id === card.coverImage) : undefined;
  const full = card.coverSize === "full" && (card.cover || coverImg);
  const age = board.display.aging ? agingLevel(card) : 0;
  const shownFields = board.fields.filter((f) => f.showOnCard && card.fields[f.id] != null && card.fields[f.id] !== "" && card.fields[f.id] !== false);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className={[
        "card-tile",
        dragging && "dragging",
        done && "done",
        board.display.compact && "compact",
        full && "full-cover",
        full && coverImg && "full-image",
        age && `aged-${age}`,
        linkRole && `link-role link-${linkRole}`,
        isLinkSource && "link-source",
        selected && "selected",
      ]
        .filter(Boolean)
        .join(" ")}
      style={full && !coverImg ? { background: card.cover! } : undefined}
      data-card-id={card.id}
      data-rel-label={linkRole ? REL_LABEL[linkRole] : undefined}
      onClick={(e) => {
        // Ctrl / Shift + click picks cards for bulk actions (e.g. handing a list of them to an AI).
        if (e.ctrlKey || e.metaKey || e.shiftKey) useStore.getState().toggleSelected(card.id);
        else openCard(card.id);
      }}
      onContextMenu={(e) => openCardMenu(e, card.id)}
      onMouseEnter={() => {
        hoveredCardId = card.id;
        if (mode.links !== "off") hoverLinks(card, useStore.getState().data.cards);
      }}
      onMouseLeave={() => {
        if (hoveredCardId === card.id) hoveredCardId = null;
        clearHoverLinks(card.id);
      }}
      onKeyDown={(e) => e.key === "Enter" && openCard(card.id)}
      tabIndex={0}
    >
      {coverImg ? (
        <img className="card-cover-img" src={storedSrc(coverImg.url)} alt="" draggable={false} />
      ) : (
        card.cover && !full && <div className="card-cover" style={{ background: card.cover }} />
      )}
      {labels.length > 0 &&
        (board.display.labelStyle === "bar" ? (
          <div className="card-label-bars">
            {labels.map((l) => (
              <span key={l.id} style={{ background: l.color }} title={l.name} />
            ))}
          </div>
        ) : (
          <div className="card-labels">
            {labels.map((l) => (
              <span key={l.id} className="label-pill" style={{ background: l.color }} title={l.name}>
                {l.name}
              </span>
            ))}
          </div>
        ))}
      <div className="card-title-row">
        <button
          className="progress-toggle"
          title={done ? "Mark not complete" : "Mark complete"}
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            updateCard(card.id, { progress: done ? "notStarted" : "completed" });
          }}
        >
          <ProgressIcon progress={card.progress} />
        </button>
        <span className="card-title">{card.title}</span>
      </div>

      {/* "Details" mode: the actual information, under the title */}
      {mode.description === "full" && card.description && <p className="tile-desc">{plainText(card.description).slice(0, 160)}</p>}
      {shownFields.length > 0 && (
        <div className="tile-fields">
          {shownFields.map((f) => {
            const v = card.fields[f.id];
            const opt = f.type === "select" ? f.options.find((o) => o.id === v) : undefined;
            return (
              <span key={f.id} className="tile-field" style={opt ? { borderColor: opt.color } : undefined}>
                {f.type === "checkbox" ? `✓ ${f.name}` : <><span className="muted">{f.name}:</span> {formatFieldValue(f, v)}</>}
              </span>
            );
          })}
        </div>
      )}
      {mode.checklist === "full" && cl.total > 0 && (shownItems.length > 0 || hiddenDone > 0) && (
        <ul className="tile-checklist">
          {shownItems.slice(0, 6).map((i) => (
            <li key={i.id} className={i.done ? "done" : ""}>
              {/* Only the checkbox is a control here; everything else opens the card like the rest of the tile. */}
              <input
                type="checkbox"
                checked={i.done}
                onPointerDown={stop}
                onClick={stop}
                onChange={() => toggleChecklistItem(card.id, i.id)}
              />
              <span className="grow">{i.cardId && <CornerDownRight size={10} className="muted" />} {i.text}</span>
              <ItemLabelDots boardId={card.boardId} item={i} />
            </li>
          ))}
          {shownItems.length > 6 && <li className="muted small">+{shownItems.length - 6} more</li>}
          {hiddenDone > 0 && <li className="muted small tile-done-note">✓ {hiddenDone} done</li>}
        </ul>
      )}
      {mode.links === "full" && linkedTitles && (
        <div className="tile-list">
          {linkedTitles.split("\n").map((t, i) => (
            <span key={i}>
              <Link2 size={11} /> {t}
            </span>
          ))}
        </div>
      )}
      {mode.attachments === "full" && card.attachments.length > 0 && (
        <div className="tile-list">
          {card.attachments.slice(0, 3).map((a) => (
            <span key={a.id}>
              <Paperclip size={11} /> {a.name}
            </span>
          ))}
          {card.attachments.length > 3 && <span className="muted">+{card.attachments.length - 3} more</span>}
        </div>
      )}
      {mode.notes === "full" && card.comments.length > 0 && (
        <p className="tile-note">
          <MessageSquare size={11} /> {plainText(card.comments[0].text).slice(0, 110)}
          <span className="muted"> · {timeAgo(card.comments[0].createdAt)}</span>
        </p>
      )}

      <div className="card-badges">
        {blocked && (
          <span className="badge blocked" title="Blocked by an unfinished task">
            <Ban size={12} /> Blocked
          </span>
        )}
        {mode.priority === "full" && <PriorityBadge priority={card.priority} showLow />}
        {mode.priority === "icon" && card.priority !== "medium" && (
          <span className="badge icon-only" title={`${priorityMeta(card.priority).name} priority`} style={{ color: priorityMeta(card.priority).color }}>
            <Flag size={12} fill="currentColor" />
          </span>
        )}
        {bucketName && <span className="badge subtle">{bucketName}</span>}
        {mode.dates !== "off" && card.dueDate && (
          <span className={`badge due-${due}`}>
            <Calendar size={12} />
            {card.startDate ? `${prettyDate(card.startDate)} – ` : ""}
            {prettyDate(card.dueDate)}
            {mode.dates === "full" && <span className="rel"> · {relativeDue(card)}</span>}
          </span>
        )}
        {mode.dates === "full" && !card.dueDate && card.startDate && (
          <span className="badge">
            <Calendar size={12} /> starts {prettyDate(card.startDate)}
          </span>
        )}
        {card.recurrence && (
          <span className="badge" title={describeRecurrence(card.recurrence)}>
            <Repeat size={12} />
            {mode.dates === "full" && describeRecurrence(card.recurrence)}
          </span>
        )}
        {mode.time !== "off" && (tracked > 0 || running || (mode.time === "full" && card.estimate)) && (
          <span className={`badge ${running ? "timer-running" : ""}`} title="Time tracked">
            <Timer size={12} />
            {formatDuration(tracked)}
            {mode.time === "full" && card.estimate ? ` / ${formatDuration(card.estimate * 60_000)}` : ""}
          </span>
        )}
        {mode.links !== "off" && parentTitles && (
          <span className="badge rel rel-parent" title={`Sub-task of:\n${parentTitles}`}>
            <CornerDownRight size={12} />
            <span className="rel-text">{parentTitles.includes("\n") ? `${parentTitles.split("\n").length} parents` : parentTitles}</span>
          </span>
        )}
        {mode.links !== "off" && subIds.length > 0 && (
          <span className="badge rel rel-child" title={`${subIds.length} sub-task${subIds.length === 1 ? "" : "s"}, ${subDone} done`}>
            <ListTree size={12} />
            {subDone}/{subIds.length}
          </span>
        )}
        {mode.links === "icon" && relCount("blocks") > 0 && (
          <span className="badge rel rel-blocked" title="Blocks other tasks">
            <Octagon size={12} />
            Blocks {relCount("blocks")}
          </span>
        )}
        {mode.links === "icon" && relCount("relates") > 0 && (
          <span className="badge rel rel-related" title="Related tasks">
            <Link2 size={12} />
            {relCount("relates")}
          </span>
        )}
        {mode.description === "icon" && card.description && (
          <span className="badge icon-only" title="Has description">
            <AlignLeft size={12} />
          </span>
        )}
        {mode.checklist === "icon" && cl.total > 0 && (
          <span className={`badge ${cl.done === cl.total ? "due-done" : ""}`}>
            <CheckSquare size={12} />
            {cl.done}/{cl.total}
          </span>
        )}
        {mode.notes === "icon" && card.comments.length > 0 && (
          <span className="badge">
            <MessageSquare size={12} />
            {card.comments.length}
          </span>
        )}
        {mode.attachments === "icon" && card.attachments.length > 0 && (
          <span className="badge">
            <Paperclip size={12} />
            {card.attachments.length}
          </span>
        )}
        {mode.assignees !== "off" && card.assignees.length > 0 && (
          <span className={`card-avatars ${mode.assignees === "full" ? "named" : ""}`}>
            {card.assignees.slice(0, mode.assignees === "full" ? 6 : 3).map((a) =>
              mode.assignees === "full" ? (
                <span key={a} className="named-avatar">
                  <Avatar name={a} size={18} /> {a}
                </span>
              ) : (
                <Avatar key={a} name={a} size={22} />
              ),
            )}
          </span>
        )}
      </div>
    </div>
  );
});

/** Small colored dots for a checklist item's labels (a linked item shows its task's labels). */
function ItemLabelDots({ boardId, item }: { boardId: ID; item: Card["checklist"][number] }) {
  const colors = useStore((s) => {
    const linked = item.cardId ? s.data.cards[item.cardId] : undefined;
    const b = s.data.boards[linked ? linked.boardId : boardId];
    const ids = linked ? linked.labelIds : item.labelIds ?? [];
    return b ? b.labels.filter((l) => ids.includes(l.id)).map((l) => `${l.color}\u0001${l.name}`).join("\u0002") : "";
  });
  if (!colors) return null;
  return (
    <span className="item-dots">
      {colors.split("\u0002").map((c) => {
        const [color, name] = c.split("\u0001");
        return <span key={c} style={{ background: color }} title={name} />;
      })}
    </span>
  );
}
