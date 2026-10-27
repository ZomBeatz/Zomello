import { LayoutTemplate, X } from "lucide-react";
import { BOARD_TEMPLATES, templateBoard, type BoardTemplate } from "../boardTemplates";
import { useStore } from "../store";
import { Modal } from "./ui";

/** Home > Start from a template: ready-made boards to begin with. */
export function BoardTemplates() {
  const close = () => useStore.getState().setOverlay({ templatesOpen: false });
  const use = (t: BoardTemplate) => {
    const st = useStore.getState();
    const taken = Object.values(st.data.boards).map((b) => b.title);
    let title = t.name;
    for (let n = 2; taken.includes(title); n++) title = `${t.name} (${n})`;
    const id = st.importBoard({ ...templateBoard(t), title }, { addPeople: false });
    st.updateBoard(id, { icon: t.icon });
    close();
    st.navigate({ page: "board", boardId: id });
    st.toast(`Made “${title}” from a template. Rename it, or change anything you like.`, { undo: true });
  };
  return (
    <Modal onClose={close} width={760}>
      <header className="customize-head">
        <h2>
          <LayoutTemplate size={18} /> Start from a template
        </h2>
        <button className="icon-btn" title="Close" aria-label="Close" onClick={close}>
          <X size={18} />
        </button>
      </header>
      <div className="customize-body">
        <div className="template-grid">
          {BOARD_TEMPLATES.map((t) => (
            <button key={t.id} className="template-tile" style={{ "--c": t.color } as React.CSSProperties} onClick={() => use(t)}>
              <span className="template-name">
                <span aria-hidden>{t.icon}</span> {t.name}
              </span>
              <span className="muted small">{t.about}</span>
              <span className="template-buckets">
                {t.lists.map((l) => (
                  <span key={l.name}>{l.name}</span>
                ))}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
