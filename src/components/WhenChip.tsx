import { useMemo, useState } from "react";
import { CalendarClock, Repeat, X } from "lucide-react";
import { readWhen, type When } from "../when";
import { describeRecurrence, prettyDateTime } from "../utils";
import { useStore } from "../store";

/**
 * A new task's title, read for a date at its end ("Dentist tomorrow 3pm"). Shows what it found, with an ×
 * to keep those words in the title instead.
 */
export function useWhen(title: string): { when: When | null; chip: React.ReactNode } {
  const [kept, setKept] = useState<string | null>(null);
  // Repeats ("every monday") are read unless turned off in Settings > Adding tasks.
  const repeats = useStore((s) => s.data.settings.titleRepeats !== false);
  const found = useMemo(() => readWhen(title, new Date(), { repeats }), [title, repeats]);
  const when = found && found.words !== kept ? found : null;
  const chip = when ? (
    <span className="when-chip" role="status">
      <CalendarClock size={13} /> Due {prettyDateTime(when.dueDate!, when.dueTime)}
      {when.recurrence && (
        <>
          <Repeat size={13} /> {describeRecurrence(when.recurrence)}
        </>
      )}
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

/** The card fields a reading sets: due date, time and repeat. */
export const whenFields = (when: When) => ({
  dueDate: when.dueDate,
  ...(when.dueTime ? { dueTime: when.dueTime } : {}),
  ...(when.recurrence ? { recurrence: when.recurrence } : {}),
});

/** What to create: the title without the date words, and the date, time and repeat. */
export const withWhen = (title: string, when: When | null) => (when ? { title: when.title, extra: whenFields(when) } : { title: title.trim(), extra: {} });
