import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  Bold, Code, Heading2, Italic, Link2, List, ListChecks, ListOrdered, Minus, Pencil, Quote, SquareCode, Strikethrough, Table,
} from "lucide-react";
import { inTauri, openExternal } from "../storage";
import { useStore } from "../store";
import { AutoTextarea, useSaveOnUnmount } from "./ui";

marked.setOptions({ gfm: true, breaks: true });

/** Clipboard API first; falls back to the old selection + copy command (works in more webviews). */
export async function copyText(text: string, done = "Copied to clipboard") {
  let ok = false;
  try {
    if (inTauri) {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
    } else await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.select();
    try {
      ok = document.execCommand("copy");
    } finally {
      ta.remove();
    }
  }
  useStore.getState().toast(ok ? done : "Couldn't copy — select the text and press Ctrl+C", { key: "copy" });
}
const copy = copyText;

/**
 * Rendered Markdown. Links open in the system browser, code blocks get a Copy button,
 * inline code copies on click, and task-list checkboxes can be toggled (via `onToggleTask`).
 */
export function Markdown({
  text,
  className = "",
  onToggleTask,
}: {
  text: string;
  className?: string;
  onToggleTask?: (index: number) => void;
}) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelectorAll("pre").forEach((pre) => {
      const btn = document.createElement("button");
      btn.className = "code-copy";
      btn.type = "button";
      btn.textContent = "Copy";
      btn.title = "Copy code";
      pre.appendChild(btn);
    });
    el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb, i) => {
      cb.disabled = !onToggleTask;
      cb.dataset.task = String(i);
    });
    el.querySelectorAll(":not(pre) > code").forEach((c) => c.setAttribute("title", "Click to copy"));
  }, [html, onToggleTask]);

  return (
    <div
      ref={ref}
      className={`markdown ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        const a = t.closest("a");
        if (a?.getAttribute("href")) {
          e.preventDefault();
          e.stopPropagation();
          void openExternal(a.getAttribute("href")!);
          return;
        }
        if (t.classList.contains("code-copy")) {
          e.stopPropagation();
          void copy(t.closest("pre")?.querySelector("code")?.textContent ?? "");
          return;
        }
        if (t.tagName === "CODE" && !t.closest("pre")) {
          e.stopPropagation();
          void copy(t.textContent ?? "");
          return;
        }
        if (t instanceof HTMLInputElement && t.dataset.task && onToggleTask) {
          e.stopPropagation();
          onToggleTask(+t.dataset.task);
        }
      }}
    />
  );
}

/** Flip the n-th "- [ ]" / "- [x]" task in a Markdown source string. */
export function toggleTask(md: string, index: number): string {
  let i = -1;
  return md.replace(/^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\])/gm, (m, a, mark, b) => {
    i++;
    return i === index ? `${a}${mark === " " ? "x" : " "}${b}` : m;
  });
}

// ---------------------------------------------------------------- editor

type Action = { icon: React.ReactNode; title: string; run: (ta: HTMLTextAreaElement) => void; key?: string };

/** Insert text the way typing would, so the textarea's own Ctrl+Z still works. */
function insert(ta: HTMLTextAreaElement, text: string, selStart: number, selEnd: number) {
  ta.focus();
  ta.setSelectionRange(selStart, selEnd);
  if (!document.execCommand("insertText", false, text)) {
    ta.setRangeText(text, selStart, selEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function wrap(ta: HTMLTextAreaElement, before: string, after = before, placeholder = "text") {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const sel = value.slice(s, e) || placeholder;
  // Toggle off when the selection is already wrapped.
  if (value.slice(s - before.length, s) === before && value.slice(e, e + after.length) === after) {
    insert(ta, sel, s - before.length, e + after.length);
    ta.setSelectionRange(s - before.length, s - before.length + sel.length);
    return;
  }
  insert(ta, before + sel + after, s, e);
  ta.setSelectionRange(s + before.length, s + before.length + sel.length);
}

/** Add (or remove) a prefix on every selected line. */
function prefixLines(ta: HTMLTextAreaElement, prefix: (i: number) => string, test: RegExp) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const start = value.lastIndexOf("\n", s - 1) + 1;
  const endIdx = value.indexOf("\n", e);
  const end = endIdx === -1 ? value.length : endIdx;
  const lines = value.slice(start, end).split("\n");
  const all = lines.every((l) => test.test(l));
  const out = lines.map((l, i) => (all ? l.replace(test, "") : prefix(i) + l.replace(test, ""))).join("\n");
  insert(ta, out, start, end);
  ta.setSelectionRange(start, start + out.length);
}

function block(ta: HTMLTextAreaElement, text: string, cursorOffset: number) {
  const { selectionStart: s, value } = ta;
  const needsNl = s > 0 && value[s - 1] !== "\n" ? "\n" : "";
  insert(ta, needsNl + text, s, ta.selectionEnd);
  const pos = s + needsNl.length + cursorOffset;
  ta.setSelectionRange(pos, pos);
}

const ACTIONS: (Action | "sep")[] = [
  { icon: <Bold size={15} />, title: "Bold (Ctrl+B)", key: "b", run: (t) => wrap(t, "**") },
  { icon: <Italic size={15} />, title: "Italic (Ctrl+I)", key: "i", run: (t) => wrap(t, "_") },
  { icon: <Strikethrough size={15} />, title: "Strikethrough", run: (t) => wrap(t, "~~") },
  { icon: <Heading2 size={15} />, title: "Heading", run: (t) => prefixLines(t, () => "## ", /^#{1,6}\s/) },
  "sep",
  { icon: <List size={15} />, title: "Bulleted list", run: (t) => prefixLines(t, () => "- ", /^[-*+]\s(?!\[)/) },
  { icon: <ListOrdered size={15} />, title: "Numbered list", run: (t) => prefixLines(t, (i) => `${i + 1}. `, /^\d+\.\s/) },
  { icon: <ListChecks size={15} />, title: "Checklist", run: (t) => prefixLines(t, () => "- [ ] ", /^[-*+]\s\[[ xX]\]\s/) },
  { icon: <Quote size={15} />, title: "Quote", run: (t) => prefixLines(t, () => "> ", /^>\s?/) },
  "sep",
  { icon: <Code size={15} />, title: "Inline code (Ctrl+E)", key: "e", run: (t) => wrap(t, "`", "`", "code") },
  {
    icon: <SquareCode size={15} />,
    title: "Code block",
    run: (t) => {
      const sel = t.value.slice(t.selectionStart, t.selectionEnd);
      block(t, "```\n" + (sel || "") + "\n```\n", 4);
    },
  },
  {
    icon: <Link2 size={15} />,
    title: "Link (Ctrl+K)",
    key: "k",
    run: (t) => {
      const { selectionStart: s, selectionEnd: e, value } = t;
      const sel = value.slice(s, e);
      const isUrl = /^https?:\/\//.test(sel);
      const text = isUrl ? `[link](${sel})` : `[${sel || "link text"}](https://)`;
      insert(t, text, s, e);
      // Select the part that still needs typing.
      if (isUrl) t.setSelectionRange(s + 1, s + 5);
      else t.setSelectionRange(s + text.length - 9, s + text.length - 1);
    },
  },
  { icon: <Table size={15} />, title: "Table", run: (t) => block(t, "| Column | Column |\n| --- | --- |\n| | |\n", 2) },
  { icon: <Minus size={15} />, title: "Divider", run: (t) => block(t, "\n---\n", 5) },
];

/** Textarea with a formatting toolbar. */
export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  onKeyDown,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: (e: React.FocusEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div
      className="md-editor"
      onBlur={(e) => {
        // Only "blur" when focus leaves the whole editor (not when clicking a toolbar button).
        if (!e.currentTarget.contains(e.relatedTarget as Node)) onBlur?.(e);
      }}
    >
      <div className="md-toolbar" role="toolbar" aria-label="Formatting">
        {ACTIONS.map((a, i) =>
          a === "sep" ? (
            <span key={i} className="md-sep" />
          ) : (
            <button
              key={i}
              type="button"
              title={a.title}
              aria-label={a.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => ref.current && a.run(ref.current)}
            >
              {a.icon}
            </button>
          ),
        )}
      </div>
      <AutoTextarea
        ref={ref}
        autoFocus={autoFocus}
        className="desc"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
            const act = ACTIONS.find((a): a is Action => a !== "sep" && a.key === e.key.toLowerCase());
            if (act && ref.current) {
              e.preventDefault();
              e.stopPropagation(); // e.g. keep Ctrl+K from opening search while editing
              act.run(ref.current);
              return;
            }
          }
          // Continue lists on Enter.
          if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && ref.current) {
            const ta = ref.current;
            const lineStart = ta.value.lastIndexOf("\n", ta.selectionStart - 1) + 1;
            const line = ta.value.slice(lineStart, ta.selectionStart);
            const m = line.match(/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)\. |> )/);
            if (m) {
              e.preventDefault();
              if (line.trim() === m[2].trim()) {
                // Empty list item: end the list.
                insert(ta, "", lineStart, ta.selectionStart);
              } else {
                const next = m[3] ? `${+m[3] + 1}. ` : m[2].replace(/\[[xX]\]/, "[ ]");
                insert(ta, "\n" + m[1] + next, ta.selectionStart, ta.selectionEnd);
              }
              return;
            }
          }
          onKeyDown?.(e);
        }}
      />
    </div>
  );
}

/** Rendered Markdown that becomes an editor when clicked (not when selecting text, copying code or following links). */
export function MarkdownField({
  value,
  onSave,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useSaveOnUnmount(() => {
    if (editing && draft !== value) onSave(draft);
  });
  const start = () => {
    setDraft(value);
    setEditing(true);
  };
  if (editing)
    return (
      <div className="md-edit">
        <MarkdownEditor
          autoFocus
          placeholder={placeholder}
          value={draft}
          onChange={setDraft}
          onBlur={() => {
            setEditing(false);
            if (draft !== value) onSave(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
        />
        <span className="muted small">Click outside or press Esc to finish. Markdown works too.</span>
      </div>
    );
  return (
    <div
      className={`md-view ${value ? "" : "empty"}`}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest("a, pre, code, button, input")) return;
        // Let people select / copy text without switching into the editor.
        if (window.getSelection()?.toString()) return;
        start();
      }}
    >
      {value ? (
        <>
          <button className="icon-btn tiny md-edit-btn" title="Edit" onClick={start}>
            <Pencil size={13} />
          </button>
          <Markdown text={value} onToggleTask={(i) => onSave(toggleTask(value, i))} />
        </>
      ) : (
        <span className="muted">{placeholder}</span>
      )}
    </div>
  );
}
