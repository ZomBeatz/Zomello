import { useMemo, useState } from "react";
import { CalendarClock, X } from "lucide-react";
import { readWhen, type When } from "../when";
import { prettyDateTime } from "../utils";

/**
 * A new task's title, read for a date at its end ("Dentist tomorrow 3pm"). Shows what it found, with an ×
 * to keep those words in the title instead.
 */
export function useWhen(title: string): { when: When | null; chip: React.ReactNode } {
  const [kept, setKept] = useState<string | null>(null);
  const found = useMemo(() => readWhen(title), [title]);
  const when = found && found.words !== kept ? found : null;
  const chip = when ? (
    <span className="when-chip" role="status">
      <CalendarClock size={13} /> Due {prettyDateTime(when.dueDate!, when.dueTime)}
      <button
        type="button"
        className="icon-btn tiny"
        title={`Keep “${when.words}” in the title`}
        aria-label={`Keep “${when.words}” in the title`}
        // Keep the focus in the title box (clicking away there adds the card).
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setKept(when.words)}
      >
        <X size={12} />
      </button>
    </span>
  ) : null;
  return { when, chip };
}

/** What to create: the title without the date words, and the date and time. */
export const withWhen = (title: string, when: When | null) =>
  when ? { title: when.title, extra: { dueDate: when.dueDate, ...(when.dueTime ? { dueTime: when.dueTime } : {}) } } : { title: title.trim(), extra: {} };
