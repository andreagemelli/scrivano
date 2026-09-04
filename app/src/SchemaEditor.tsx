import { useState, type KeyboardEvent, type ReactNode } from "react";
import { CaretDown, Check, Plus, Question, Trash, Warning } from "@phosphor-icons/react";
import { useT } from "./i18n";
import type { Field } from "./types";

/**
 * A list of name + description rows. Both things the model is handed have that
 * shape — the extraction schema and the class list — so this edits either, told
 * only what the trained vocabulary is.
 */
export default function SchemaEditor({
  fields,
  known,
  kind,
  head,
  onChange,
}: {
  fields: Field[];
  /** Trained name → description. Drives the presets and the untrained flag. */
  known: Record<string, string>;
  /** Which of the two lists this is. Only the words differ. */
  kind: "field" | "class";
  /**
   * Controls the caller wants on this editor's own header row. The Classes tab
   * has two of them, and wrapping this component to place them instead put a
   * `.group` inside a `.group` — whose `align-items: flex-start` then stopped
   * the whole list from stretching, which is why the class rows were half a
   * drawer wide while the identical schema rows were not.
   */
  head?: ReactNode;
  onChange: (f: Field[]) => void;
}) {
  const shared = useT();
  const t = shared.rows[kind];
  const [focus, setFocus] = useState(-1);
  const [menu, setMenu] = useState<"" | "preset" | "paste">("");
  const [filter, setFilter] = useState("");
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState("");

  const set = (i: number, f: Field) => onChange(fields.map((old, n) => (n === i ? f : old)));

  function addAfter(i: number) {
    const next = [...fields];
    next.splice(i + 1, 0, { key: "", description: "" });
    onChange(next);
    setFocus(i + 1);
  }

  function remove(i: number) {
    onChange(fields.filter((_, n) => n !== i));
    setFocus(Math.max(0, i - 1));
  }

  function onKeyDown(e: KeyboardEvent, i: number, isKey: boolean) {
    if (e.key === "Enter") {
      e.preventDefault();
      addAfter(i);
    } else if (e.key === "Backspace" && isKey && fields[i].key === "") {
      e.preventDefault();
      remove(i);
    }
  }

  /**
   * Picking a preset key adds it to the schema straight away, filling in the
   * official description. The popover stays open so several keys can be added
   * in one go; it closes on Escape, on clicking outside, or on the Preset button.
   */
  function pick(key: string) {
    const i = fields.findIndex((f) => f.key === key);
    if (i >= 0) set(i, { key, description: known[key] });
    else onChange([...fields, { key, description: known[key] }]);
  }

  function applyJson() {
    try {
      const obj: unknown = JSON.parse(json);
      if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
        throw new Error(t.expectedObject);
      }
      onChange(
        Object.entries(obj as Record<string, unknown>).map(([key, d]) => ({
          key,
          description: String(d),
        })),
      );
      setMenu("");
      setJson("");
      setJsonError("");
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : String(e));
    }
  }

  const keys = Object.keys(known).filter((k) => k.includes(filter.trim().toLowerCase()));

  return (
    <section className="group">
      {/* No title and no count here: the drawer's tab bar already carries both. */}
      <div className="group-head">
        {head}
        {/* The model wants the prompt in the document's own language, and a
            description written in another one quietly makes the answer worse.
            Say it here, where the descriptions are edited. */}
        <button className="help" aria-label={t.help} data-hint={t.help}>
          <Question size={14} weight="regular" />
        </button>
        <span className="grow" />
        <div
          className="popwrap"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setMenu("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setMenu("");
            }
          }}
        >
          <button className="btn" onClick={() => setMenu(menu === "preset" ? "" : "preset")}>
            {shared.presets}
            <CaretDown size={12} weight="regular" />
          </button>
          {menu === "preset" && (
            <div className="popover">
              <input
                autoFocus
                placeholder={t.filter}
                aria-label={t.filterLabel}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <div className="poplist">
                {keys.map((k) => {
                  const added = fields.some((f) => f.key === k);
                  return (
                    <button
                      key={k}
                      data-hint={known[k]}
                      // WebKit does not focus a button on click, so letting the
                      // press move focus fires the wrapper's blur handler, closes
                      // the popover and the click never lands. Holding focus on
                      // the filter input keeps the popover alive.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(k)}
                    >
                      <span>{k}</span>
                      {added && <Check size={13} weight="bold" aria-label={t.alreadyIn} />}
                    </button>
                  );
                })}
                {keys.length === 0 && <p className="hint">{t.noMatch}</p>}
              </div>
            </div>
          )}
        </div>
        <div
          className="popwrap"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setMenu("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setMenu("");
            }
          }}
        >
          <button className="btn" onClick={() => setMenu(menu === "paste" ? "" : "paste")}>
            {shared.pasteJson}
            <CaretDown size={12} weight="regular" />
          </button>
          {menu === "paste" && (
            <div className="popover">
              <textarea
                autoFocus
                rows={7}
                aria-label={t.jsonLabel}
                placeholder={t.jsonPlaceholder}
                value={json}
                onChange={(e) => setJson(e.target.value)}
              />
              <div className="popfoot">
                <button className="btn" onClick={applyJson}>
                  {t.replaceAll}
                </button>
                {jsonError !== "" && <span className="err-text">{jsonError}</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="field-list">
        {fields.map((f, i) => (
          <div className="field" key={i}>
            <div className="field-body">
              <input
                className="k"
                placeholder={t.namePlaceholder}
                aria-label={t.nameLabel(i + 1)}
                value={f.key}
                ref={(el) => {
                  if (el && i === focus) {
                    el.focus();
                    setFocus(-1);
                  }
                }}
                onChange={(e) => set(i, { ...f, key: e.target.value })}
                onKeyDown={(e) => onKeyDown(e, i, true)}
              />
              {/* A textarea, because these descriptions steer the model and every
                  preset one is longer than a single line of this column. It grows
                  to its content so no description is ever clipped. */}
              <textarea
                className="d"
                rows={1}
                aria-label={t.descriptionLabel(i + 1)}
                ref={(el) => {
                  if (el) {
                    el.style.height = "0";
                    el.style.height = `${el.scrollHeight}px`;
                  }
                }}
                placeholder={t.descriptionPlaceholder}
                value={f.description}
                onChange={(e) => set(i, { ...f, description: e.target.value })}
                onKeyDown={(e) => onKeyDown(e, i, false)}
              />
            </div>
            {f.key.trim() !== "" && !(f.key in known) && (
              <span className="flag field-flag" data-hint={t.untrainedHelp}>
                <Warning size={13} weight="regular" />
                {t.untrained}
              </span>
            )}
            <button
              className="icon-btn field-del"
              aria-label={shared.removeRow(f.key.trim() === "" ? t.theRow : f.key)}
              data-hint={shared.removeRow(f.key.trim() === "" ? t.theRow : f.key)}
              onClick={() => remove(i)}
            >
              <Trash size={15} weight="regular" />
            </button>
          </div>
        ))}
        {fields.length === 0 && (
          <p className="hint">{t.empty}</p>
        )}
      </div>

      <button className="btn" onClick={() => addAfter(fields.length - 1)}>
        <Plus size={14} weight="regular" />
        {t.add}
      </button>
    </section>
  );
}
