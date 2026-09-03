import { Plus, SidebarSimple, Trash, Warning } from "@phosphor-icons/react";
import type { Doc } from "./types";

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "adesso";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h fa`;
  return `${Math.round(h / 24)} g fa`;
}

/**
 * What the row says under the name. A finished run reports only what it
 * returned: measuring it against the schema on screen relabels old runs every
 * time the schema is edited, which is how "7 of 2 fields" happened.
 */
function summary(d: Doc): string {
  const n = d.result ? Object.keys(d.result).length : d.fields.length;
  return `${n} ${n === 1 ? "campo" : "campi"}`;
}

/** Status in words, so no row depends on the colour of a dot. */
function state(d: Doc): string {
  if (d.status === "reading") return "lettura";
  if (d.status === "extracting") return "estrazione";
  if (d.status === "failed") return "errore";
  return "";
}

/** Two letters off the filename, so a collapsed tile says which document it is. */
function initials(name: string): string {
  const parts = name.replace(/\.[^.]+$/, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

export default function Sidebar({
  docs,
  activeId,
  open,
  onToggle,
  onSelect,
  onAdd,
  onDelete,
}: {
  docs: Doc[];
  activeId: string | null;
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
}) {
  const label = open ? "Comprimi l'elenco dei documenti" : "Espandi l'elenco dei documenti";

  return (
    <aside className={open ? "rail" : "rail collapsed"}>
      <div className="rail-top">
        <button
          className="icon-btn"
          aria-label={label}
          aria-expanded={open}
          title={label}
          onClick={onToggle}
        >
          <SidebarSimple size={17} weight="regular" />
        </button>
        {open && (
          <span className="rail-count">
            {docs.length} {docs.length === 1 ? "documento" : "documenti"}
          </span>
        )}
      </div>

      <div className="rail-list">
        {open && docs.length === 0 && (
          <p className="hint">Ancora niente. I documenti che apri restano in questo elenco.</p>
        )}

        {docs.map((d) =>
          open ? (
            <div key={d.id} className={d.id === activeId ? "doc-card active" : "doc-card"}>
              <button className="doc-main" onClick={() => onSelect(d.id)}>
                <span className="doc-name" title={d.name}>
                  {d.name}
                </span>
                <span className="doc-meta">
                  {(d.status === "reading" || d.status === "extracting") && (
                    <i className="dot busy" />
                  )}
                  {d.status === "failed" && <i className="dot failed" />}
                  {ago(d.addedAt)}
                  {state(d) !== "" && ` \u00b7 ${state(d)}`} &middot; {summary(d)}
                </span>
              </button>
              <button
                className="icon-btn doc-del"
                aria-label={`Elimina ${d.name}`}
                title={`Elimina ${d.name}`}
                onClick={() => onDelete(d.id)}
              >
                <Trash size={15} weight="regular" />
              </button>
            </div>
          ) : (
            <button
              key={d.id}
              className={d.id === activeId ? "doc-mini active" : "doc-mini"}
              aria-label={d.name}
              aria-current={d.id === activeId}
              title={`${d.name} (${summary(d)}${state(d) === "" ? "" : `, ${state(d)}`})`}
              onClick={() => onSelect(d.id)}
            >
              {initials(d.name)}
              {(d.status === "reading" || d.status === "extracting") && <i className="dot busy" />}
              {/* A shape, not a hue: the failed tile is readable without colour. */}
              {d.status === "failed" && <Warning className="warn" size={13} weight="fill" />}
            </button>
          ),
        )}
      </div>

      {/* Pinned to the floor of the rail in both states, so the one thing you
          always want is always in the same place. */}
      <div className="rail-foot">
        <button className="fab" aria-label="Aggiungi un documento" title="Aggiungi un documento" onClick={onAdd}>
          <Plus size={20} weight="bold" />
        </button>
      </div>
    </aside>
  );
}
