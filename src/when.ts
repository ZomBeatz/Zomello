import { addDays, addMonths, addWeeks, format, startOfMonth } from "date-fns";
import { toISO } from "./utils";

/**
 * Dates and times typed at the end of a new task's title: "Dentist tomorrow 3pm", "Pay rent on the 1st",
 * "Call Sam friday at 2:30", "Report due Oct 28". Only the end of the title is read, so "Plan Friday party"
 * stays as it is. English words only.
 */
export interface When {
  /** The title without the date words. */
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  /** The words that were read, as typed ("tomorrow 3pm"). */
  words: string;
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_RE = "(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday)?";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const ORD = "(\\d{1,2})(?:st|nd|rd|th)?";

const dayIndex = (s: string) => DAYS.findIndex((d) => d.startsWith(s.toLowerCase().slice(0, 3)));
const monthIndex = (s: string) => MONTHS.indexOf(s.toLowerCase().slice(0, 3));
const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/** This date, or (when it's already past this year) the same date next year. */
function upcomingDate(now: Date, month: number, day: number, year?: number): Date | null {
  const y = year ?? now.getFullYear();
  const d = new Date(y < 100 ? 2000 + y : y, month, day);
  if (d.getMonth() !== month) return null; // Feb 31 and the like
  if (year === undefined && toISO(d) < toISO(now)) d.setFullYear(d.getFullYear() + 1);
  return d;
}

/** Day-first ("28/10") where people write dates that way, month-first ("10/28") in the US. */
const dayFirst = () => !/^en-(US|PH|CA)$|^en$/i.test(typeof navigator === "undefined" ? "en-US" : navigator.language);

type Rule = { re: string; date?: (m: RegExpMatchArray, now: Date) => Date | null; time?: (m: RegExpMatchArray) => string | null };

const TIME_RULES: Rule[] = [
  { re: "noon|midday", time: () => "12:00" },
  { re: "midnight", time: () => "23:59" },
  {
    re: "(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)",
    time: (m) => {
      let h = Number(m[1]);
      const min = Number(m[2] ?? 0);
      if (h < 1 || h > 12 || min > 59) return null;
      const pm = m[3].toLowerCase().startsWith("p");
      if (h === 12) h = pm ? 12 : 0;
      else if (pm) h += 12;
      return hhmm(h, min);
    },
  },
  {
    re: "(\\d{1,2}):(\\d{2})",
    time: (m) => (Number(m[1]) < 24 && Number(m[2]) < 60 ? hhmm(Number(m[1]), Number(m[2])) : null),
  },
];
/** "at 3" (only with "at": a bare number is too often part of the title). 1 to 7 means afternoon. */
const AT_HOUR: Rule = {
  re: "(\\d{1,2})",
  time: (m) => {
    const h = Number(m[1]);
    if (h > 23) return null;
    return hhmm(h >= 1 && h <= 7 ? h + 12 : h, 0);
  },
};

const DATE_RULES: Rule[] = [
  { re: "today|tod", date: (_, n) => n },
  { re: "tonight", date: (_, n) => n },
  { re: "day after tomorrow", date: (_, n) => addDays(n, 2) },
  { re: "tomorrow|tmrw|tmr|tom", date: (_, n) => addDays(n, 1) },
  { re: "next week", date: (_, n) => addDays(n, ((8 - n.getDay()) % 7) || 7) },
  { re: "next month", date: (_, n) => startOfMonth(addMonths(n, 1)) },
  { re: "(?:in )?(a|an|one|\\d{1,3}) (day|week|month)s?(?: from now)?", date: (m, n) => {
      const k = /^\d/.test(m[1]) ? Number(m[1]) : 1;
      return m[2] === "day" ? addDays(n, k) : m[2] === "week" ? addWeeks(n, k) : addMonths(n, k);
    } },
  { re: `next ${DAY_RE}`, date: (m, n) => {
      // The one after the coming one, as people usually mean it ("next friday" on a Monday = in 11 days).
      const ahead = ((dayIndex(m[1]) - n.getDay() + 7) % 7) || 7;
      return addDays(n, ahead + 7);
    } },
  { re: `(?:this )?${DAY_RE}`, date: (m, n) => addDays(n, (dayIndex(m[1]) - n.getDay() + 7) % 7) },
  { re: `${MONTH_RE}\\.? ${ORD}(?:,? (\\d{4}))?`, date: (m, n) => upcomingDate(n, monthIndex(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined) },
  { re: `${ORD} (?:of )?${MONTH_RE}\\.?(?:,? (\\d{4}))?`, date: (m, n) => upcomingDate(n, monthIndex(m[2]), Number(m[1]), m[3] ? Number(m[3]) : undefined) },
  { re: "(\\d{4})-(\\d{1,2})-(\\d{1,2})", date: (m) => {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return d.getMonth() === Number(m[2]) - 1 ? d : null;
    } },
  { re: "(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?", date: (m, n) => {
      const [a, b] = [Number(m[1]), Number(m[2])];
      const [month, day] = dayFirst() ? [b, a] : [a, b];
      if (month < 1 || month > 12) return null;
      return upcomingDate(n, month - 1, day, m[3] ? Number(m[3]) : undefined);
    } },
  { re: `the ${ORD}`, date: (m, n) => {
      const day = Number(m[1]);
      if (day < 1 || day > 31) return null;
      const d = new Date(n.getFullYear(), n.getMonth(), day);
      if (toISO(d) < toISO(n) || d.getMonth() !== n.getMonth()) return new Date(n.getFullYear(), n.getMonth() + 1, day);
      return d;
    } },
];

/** Take one rule's match off the end of `text` (with "on", "at", "by" or "due" before it). */
function peel(text: string, rule: Rule, lead: string) {
  const m = text.match(new RegExp(`(^|\\s)((?:${lead})\\s+)?(?:${rule.re})[.,!]?$`, "i"));
  if (!m || m.index === undefined) return null;
  const inner = m[0].trim().replace(new RegExp(`^(?:${lead})\\s+`, "i"), "");
  const sub = inner.replace(/[.,!]$/, "").match(new RegExp(`^(?:${rule.re})$`, "i"));
  if (!sub) return null;
  return { rest: text.slice(0, m.index + m[1].length).trimEnd(), words: m[0].trim(), m: sub };
}

export function readWhen(input: string, now = new Date()): When | null {
  let text = input.trimEnd();
  let date: Date | null = null;
  let time: string | null = null;
  const words: string[] = [];
  // Up to three pieces, from the end: "friday at 3pm", "3pm friday", "tomorrow".
  for (let round = 0; round < 3; round++) {
    let found = false;
    if (!time) {
      for (const rule of TIME_RULES) {
        const p = peel(text, rule, "at|by|@");
        const t = p && rule.time!(p.m);
        if (p && t) {
          time = t;
          text = p.rest;
          words.unshift(p.words);
          found = true;
          break;
        }
      }
      if (!found) {
        const p = peel(text, AT_HOUR, "at|@");
        const t = p && /^(at|@)\s/i.test(p.words) ? AT_HOUR.time!(p.m) : null;
        if (p && t) {
          time = t;
          text = p.rest;
          words.unshift(p.words);
          found = true;
        }
      }
    }
    if (!found && !date) {
      for (const rule of DATE_RULES) {
        const p = peel(text, rule, "on|by|due|due on|due by");
        const d = p && rule.date!(p.m, now);
        if (p && d) {
          date = d;
          if (/^tonight$/i.test(p.m[0]) && !time) time = "19:00";
          text = p.rest;
          words.unshift(p.words);
          found = true;
          break;
        }
      }
    }
    if (!found) break;
  }
  text = text.replace(/\s+(?:on|at|by|due)$/i, "").trimEnd();
  if ((!date && !time) || !text) return null;
  // A time alone means today, or tomorrow if that time has passed.
  if (!date) date = time! > format(now, "HH:mm") ? now : addDays(now, 1);
  return { title: text, dueDate: toISO(date), dueTime: time, words: words.join(" ") };
}
