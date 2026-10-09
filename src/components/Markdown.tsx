import { useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { openExternal } from "../storage";
import { AutoTextarea } from "./ui";

marked.setOptions({ gfm: true, breaks: true });

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text]);
  return (
    <div
      className={`markdown ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        // Links open in the system browser instead of navigating the app window.
        const a = (e.target as HTMLElement).closest("a");
        if (a?.getAttribute("href")) {
          e.preventDefault();
          e.stopPropagation();
          void openExternal(a.getAttribute("href")!);
        }
      }}
    />
  );
}

/** Rendered Markdown that turns into a textarea on click; saves on blur. */
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
  if (editing)
    return (
      <div className="md-edit">
        <AutoTextarea
          autoFocus
          className="desc"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
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
        <span className="muted small">
          Markdown supported: **bold**, _italic_, # headings, - lists, - [ ] tasks, [links](https://…), `code`
        </span>
      </div>
    );
  return (
    <div
      className={`md-view ${value ? "" : "empty"}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) return;
        setDraft(value);
        setEditing(true);
      }}
      title="Click to edit"
    >
      {value ? <Markdown text={value} /> : <span className="muted">{placeholder}</span>}
    </div>
  );
}
