import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, CheckCircle2, CircleDashed, CircleDot, CirclePause, Hourglass, X } from "lucide-react";
import type { Priority, Progress } from "../types";
import { colorFor, initials, PALETTE, priorityMeta, safeArea } from "../utils";

export function Modal({
  onClose,
  children,
  width = 860,
  className = "",
}: {
  onClose: () => void;
  children: ReactNode;
  width?: number;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`} style={{ maxWidth: width }} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Small anchored popover that closes on outside click / Escape. */
export function Popover({
  trigger,
  children,
  align = "left",
  className = "",
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const w = panel.current?.offsetWidth ?? 240;
    const h = panel.current?.offsetHeight ?? 0;
    // Keep clear of the phone's status bar and gesture bar (zero on a computer).
    const safe = safeArea();
    let left = align === "right" ? r.right - w : r.left;
    left = Math.max(safe.left + 8, Math.min(left, window.innerWidth - safe.right - w - 8));
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - safe.bottom - 8) top = Math.max(safe.top + 8, r.top - h - 4);
    setPos({ top, left });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <>
      <span ref={anchor} className="popover-anchor">
        {trigger(open, () => setOpen((o) => !o))}
      </span>
      {open &&
        createPortal(
          <div
            ref={panel}
            className={`popover ${className}`}
            style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button className={`menu-item ${danger ? "danger" : ""}`} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <span
      className="avatar"
      title={name}
      style={{ width: size, height: size, fontSize: size * 0.42, background: colorFor(name) }}
    >
      {initials(name)}
    </span>
  );
}

export function ProgressIcon({ progress, size = 16 }: { progress: Progress; size?: number }) {
  if (progress === "completed") return <CheckCircle2 size={size} className="prog-done" />;
  if (progress === "inProgress") return <CircleDot size={size} className="prog-doing" />;
  if (progress === "waiting") return <Hourglass size={size} className="prog-waiting" />;
  if (progress === "onHold") return <CirclePause size={size} className="prog-hold" />;
  return <CircleDashed size={size} className="prog-todo" />;
}

export function PriorityBadge({ priority, showLow = false }: { priority: Priority; showLow?: boolean }) {
  if (priority === "medium" || (priority === "low" && !showLow)) return null;
  const m = priorityMeta(priority);
  return (
    <span className="badge" style={{ color: m.color, borderColor: m.color }}>
      {priority === "urgent" ? "!!" : priority === "important" ? "!" : "↓"} {m.name}
    </span>
  );
}

export function ColorPicker({
  value,
  onChange,
  allowNone,
}: {
  value: string | null;
  onChange: (c: string | null) => void;
  allowNone?: boolean;
}) {
  return (
    <div className="swatches">
      {allowNone && (
        <button className={`swatch none ${value === null ? "sel" : ""}`} onClick={() => onChange(null)} title="None">
          <X size={12} />
        </button>
      )}
      {PALETTE.map((c) => (
        <button
          key={c}
          className={`swatch ${value === c ? "sel" : ""}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        >
          {value === c && <Check size={12} color="#fff" />}
        </button>
      ))}
    </div>
  );
}

/**
 * Run `save` when the component goes away (a window closes, another card opens…), so typing that
 * hasn't been committed yet is never lost. `save` should do nothing when there's nothing to save.
 */
export function useSaveOnUnmount(save: () => void) {
  const ref = useRef(save);
  ref.current = save;
  useEffect(() => () => ref.current(), []);
}

/**
 * A text box that saves when you press Enter, click away, or close the window it's in, so a typed
 * value is never lost. `onCommit` only runs when the text actually changed.
 */
export function CommitInput({
  value,
  onCommit,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange"> & {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);
  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    if (draft !== value) onCommit(draft);
  };
  useSaveOnUnmount(commit);
  return (
    <input
      {...props}
      value={draft}
      onChange={(e) => {
        dirty.current = true;
        setDraft(e.target.value);
      }}
      onBlur={(e) => {
        commit();
        props.onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        props.onKeyDown?.(e);
      }}
    />
  );
}

/** Text that turns into an input on click; commits on Enter / blur. */
export function InlineEdit({
  value,
  onSave,
  className = "",
  placeholder,
  multiline,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onSave(v);
    else setDraft(value);
  };
  useSaveOnUnmount(() => {
    const v = draft.trim();
    if (editing && v && v !== value) onSave(v);
  });
  if (!editing)
    return (
      <span className={`inline-edit ${className}`} onClick={() => setEditing(true)} title="Click to edit">
        {value || <span className="muted">{placeholder}</span>}
      </span>
    );
  const props = {
    autoFocus: true,
    className: `inline-input ${className}`,
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commit();
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        setDraft(value);
        setEditing(false);
      }
    },
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.target.select(),
  };
  return multiline ? <textarea rows={2} {...props} /> : <input {...props} />;
}

export function AutoTextarea({
  ref: outerRef,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: React.Ref<HTMLTextAreaElement> }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(outerRef, () => ref.current!);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} {...props} />;
}

// ---- In-app confirm dialog (native confirm() is unreliable inside some webviews) ----
interface ConfirmReq {
  message: string;
  okText: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}
let showConfirm: ((r: ConfirmReq) => void) | null = null;

export function ask(message: string, { okText = "OK", danger = false } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!showConfirm) return resolve(window.confirm(message));
    showConfirm({ message, okText, danger, resolve });
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  useEffect(() => {
    showConfirm = setReq;
    return () => {
      showConfirm = null;
    };
  }, []);
  if (!req) return null;
  const done = (ok: boolean) => {
    req.resolve(ok);
    setReq(null);
  };
  return (
    <Modal onClose={() => done(false)} width={420} className="confirm">
      <p>{req.message}</p>
      <div className="row end gap">
        <button className="btn" onClick={() => done(false)}>
          Cancel
        </button>
        <button className={`btn ${req.danger ? "danger" : "primary"}`} autoFocus onClick={() => done(true)}>
          {req.okText}
        </button>
      </div>
    </Modal>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children}
    </div>
  );
}
