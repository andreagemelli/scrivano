import { useState } from "react";
import { Plus, SidebarSimple, Trash, Warning } from "@phosphor-icons/react";
import { useT } from "./i18n";
import type { Dict } from "./i18n";
import type { Doc } from "./types";

/** How the rail is arranged. "class" is the one that groups rather than sorts. */
type Order = "recent" | "name" | "class";

function ago(t: Dict, ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return t.justNow;
  const m = Math.round(s / 60);
  if (m < 60) return t.minutesAgo(m);
  const h = Math.round(m / 60);
  if (h < 24) return t.hoursAgo(h);
  return t.daysAgo(Math.round(h / 24));
}

/**
 * What the row says under the name. A finished run reports only what it
 * returned: measuring it against the schema on screen relabels old runs every
 * time the schema is edited, which is how "7 of 2 fields" happened.
 */
function summary(t: Dict, d: Doc): string {
  return t.fields(d.result ? Object.keys(d.result).length : d.fields.length);
}

/** Status in words, so no row depends on the colour of a dot. */
function state(t: Dict, d: Doc): string {
  if (d.status === "reading") return t.rowState.reading;
  if (d.status === "classifying") return t.rowState.classifying;
  if (d.status === "extracting") return t.rowState.extracting;
  if (d.status === "failed") return t.rowState.failed;
  return "";
}

/** Two letters off the filename, so a collapsed tile says which document it is. */
function initials(name: string): string {
  const parts = name.replace(/\.[^.]+$/, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

/** The states that pulse a dot rather than sitting still. */
function busy(d: Doc): boolean {
  return d.status === "reading" || d.status === "extracting" || d.status === "classifying";
}

/**
 * The rail contents, as a flat list of headings and documents.
 *
 * Grouping and sorting are the same question — what order do I want to see
 * these in — so they are one control, and the one option that happens to group
 * emits headings into the same list rather than a second kind of render.
 * Within a class, and everywhere else, ties break on recency: the newest
 * document is the one you just opened.
 */
function arrange(t: Dict, docs: Doc[], order: Order): (Doc | { heading: string })[] {
  const recent = [...docs].sort((a, b) => b.addedAt - a.addedAt);
  if (order === "recent") return recent;
  if (order === "name") {
    return recent.sort((a, b) => a.name.localeCompare(b.name, t.htmlLang));
  }

  // Classes in first-seen order, so the rail does not reshuffle itself every
  // time a classification lands. Unclassified documents go last: they are the
  // ones nothing is known about, not a class of their own.
  const groups = new Map<string, Doc[]>();
  for (const d of recent) {
    const key = d.docClass ?? "";
    const group = groups.get(key);
    if (group) group.push(d);
    else groups.set(key, [d]);
  }
  const named = [...groups.entries()]
    .filter(([k]) => k !== "")
    .sort((a, b) => a[0].localeCompare(b[0], t.htmlLang));
  const rest = groups.get("");
  if (rest) named.push([t.unclassified, rest]);

  return named.flatMap(([heading, group]) => [{ heading }, ...group]);
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
  const t = useT();
  const [order, setOrder] = useState<Order>("recent");
  const label = open ? t.collapseRail : t.expandRail;
  // Collapsed the rail is a column of two-letter tiles with no room for a
  // heading, so it always shows the plain recent list.
  const items = arrange(t, docs, open ? order : "recent");

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
        {open && <span className="rail-count">{t.documents(docs.length)}</span>}
      </div>

      {/* One control for both, and only once there is something to arrange. */}
      {open && docs.length > 1 && (
        <label className="rail-order">
          <span className="muted">{t.order}</span>
          <select value={order} onChange={(e) => setOrder(e.target.value as Order)}>
            <option value="recent">{t.orderRecent}</option>
            <option value="name">{t.orderName}</option>
            <option value="class">{t.orderClass}</option>
          </select>
        </label>
      )}

      <div className="rail-list">
        {open && docs.length === 0 && <p className="hint">{t.railEmpty}</p>}

        {items.map((item) =>
          "heading" in item ? (
            <h3 className="rail-group" key={`h:${item.heading}`}>
              {item.heading}
            </h3>
          ) : open ? (
            <div
              key={item.id}
              className={item.id === activeId ? "doc-card active" : "doc-card"}
            >
              <button className="doc-main" onClick={() => onSelect(item.id)}>
                <span className="doc-name" title={item.name}>
                  {item.name}
                </span>
                <span className="doc-meta">
                  {busy(item) && <i className="dot busy" />}
                  {item.status === "failed" && <i className="dot failed" />}
                  {ago(t, item.addedAt)}
                  {state(t, item) !== "" && ` · ${state(t, item)}`} &middot; {summary(t, item)}
                </span>
                {/* What the model said this document is. Absent rather than
                    guessed at: an empty tag would read as a class called "". */}
                {item.docClass !== undefined && (
                  <span className="tag doc-class">{item.docClass}</span>
                )}
              </button>
              <button
                className="icon-btn doc-del"
                aria-label={t.deleteDocument(item.name)}
                title={t.deleteDocument(item.name)}
                onClick={() => onDelete(item.id)}
              >
                <Trash size={15} weight="regular" />
              </button>
            </div>
          ) : (
            <button
              key={item.id}
              className={item.id === activeId ? "doc-mini active" : "doc-mini"}
              aria-label={item.name}
              aria-current={item.id === activeId}
              title={`${item.name} · ${item.docClass ?? t.noClass} (${summary(t, item)}${
                state(t, item) === "" ? "" : `, ${state(t, item)}`
              })`}
              onClick={() => onSelect(item.id)}
            >
              {initials(item.name)}
              {busy(item) && <i className="dot busy" />}
              {/* A shape, not a hue: the failed tile is readable without colour. */}
              {item.status === "failed" && <Warning className="warn" size={13} weight="fill" />}
            </button>
          ),
        )}
      </div>

      {/* Pinned to the floor of the rail in both states, so the one thing you
          always want is always in the same place. */}
      <div className="rail-foot">
        <button className="fab" aria-label={t.addDocument} title={t.addDocument} onClick={onAdd}>
          <Plus size={20} weight="bold" />
        </button>
      </div>
    </aside>
  );
}
