import { memo } from "react";
import { AlignLeft, Calendar, CheckSquare, MessageSquare, Paperclip } from "lucide-react";
import type { Board, Card } from "../types";
import { useStore } from "../store";
import { checklistStats, dueStatus, prettyDate } from "../utils";
import { Avatar, PriorityBadge, ProgressIcon } from "./ui";

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
  const labels = board.labels.filter((l) => card.labelIds.includes(l.id));
  const cl = checklistStats(card);
  const due = dueStatus(card);
  const done = card.progress === "completed";

  return (
    <div
      className={`card-tile ${dragging ? "dragging" : ""} ${done ? "done" : ""}`}
      onClick={() => openCard(card.id)}
      onKeyDown={(e) => e.key === "Enter" && openCard(card.id)}
      tabIndex={0}
    >
      {card.cover && <div className="card-cover" style={{ background: card.cover }} />}
      {labels.length > 0 && (
        <div className="card-labels">
          {labels.map((l) => (
            <span key={l.id} className="label-pill" style={{ background: l.color }} title={l.name}>
              {l.name}
            </span>
          ))}
        </div>
      )}
      <div className="card-title-row">
        <button
          className="progress-toggle"
          title={done ? "Mark not complete" : "Mark complete"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            updateCard(card.id, { progress: done ? "notStarted" : "completed" });
          }}
        >
          <ProgressIcon progress={card.progress} />
        </button>
        <span className="card-title">{card.title}</span>
      </div>
      <div className="card-badges">
        <PriorityBadge priority={card.priority} />
        {bucketName && <span className="badge subtle">{bucketName}</span>}
        {card.dueDate && (
          <span className={`badge due-${due}`}>
            <Calendar size={12} />
            {card.startDate ? `${prettyDate(card.startDate)} – ` : ""}
            {prettyDate(card.dueDate)}
          </span>
        )}
        {card.description && (
          <span className="badge icon-only" title="Has description">
            <AlignLeft size={12} />
          </span>
        )}
        {cl.total > 0 && (
          <span className={`badge ${cl.done === cl.total ? "due-done" : ""}`}>
            <CheckSquare size={12} />
            {cl.done}/{cl.total}
          </span>
        )}
        {card.comments.length > 0 && (
          <span className="badge">
            <MessageSquare size={12} />
            {card.comments.length}
          </span>
        )}
        {card.attachments.length > 0 && (
          <span className="badge">
            <Paperclip size={12} />
            {card.attachments.length}
          </span>
        )}
        {card.assignees.length > 0 && (
          <span className="card-avatars">
            {card.assignees.slice(0, 3).map((a) => (
              <Avatar key={a} name={a} size={22} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
});
