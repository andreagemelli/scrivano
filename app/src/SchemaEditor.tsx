import { useState, type KeyboardEvent } from "react";
import { CaretDown, Check, Plus, Question, Trash, Warning } from "@phosphor-icons/react";
import schema from "./schema.json";
import type { Field } from "./types";

const SCHEMA: Record<string, string> = schema;

/**
 * The model was fine-tuned on prompts averaging seven fields, so a new document
 * starts with seven, not all thirty five. More keys means less precision.
 */
const DEFAULT_KEYS = [
  "nome",
  "cognome",
  "data-nascita",
  "luogo-nascita",
  "codice-fiscale",
  "indirizzo",
  "comune",
];

export function defaultFields(): Field[] {
  return DEFAULT_KEYS.map((key) => ({ key, description: SCHEMA[key] }));
}

const UNTRAINED = "Questa chiave non era nello schema di fine-tuning: il modello non l'ha mai vista.";

export default function SchemaEditor({
  fields,
  onChange,
}: {
  fields: Field[];
  onChange: (f: Field[]) => void;
}) {
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
    if (i >= 0) set(i, { key, description: SCHEMA[key] });
    else onChange([...fields, { key, description: SCHEMA[key] }]);
  }

  function applyJson() {
    try {
      const obj: unknown = JSON.parse(json);
      if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
        throw new Error("atteso un oggetto JSON che associa chiave e descrizione");
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

  const keys = Object.keys(SCHEMA).filter((k) => k.includes(filter.trim().toLowerCase()));

  return (
    <section className="group">
      {/* No title and no count here: the drawer's tab bar already carries both. */}
      <div className="group-head">
        {/* The interface is Italian, the descriptions are not, and a user who
            translates them is quietly making the extraction worse. Say it
            once, here, where the descriptions are edited. */}
        <span
          className="help"
          title="Le descrizioni finiscono nel prompt del modello, che è stato addestrato in inglese: lasciale in inglese. I preset portano già la formulazione con cui è stato addestrato."
        >
          <Question size={14} weight="regular" />
        </span>
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
            Predefiniti
            <CaretDown size={12} weight="regular" />
          </button>
          {menu === "preset" && (
            <div className="popover">
              <input
                autoFocus
                placeholder="Filtra le chiavi"
                aria-label="Filtra le chiavi predefinite"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <div className="poplist">
                {keys.map((k) => {
                  const added = fields.some((f) => f.key === k);
                  return (
                    <button
                      key={k}
                      title={SCHEMA[k]}
                      // WebKit does not focus a button on click, so letting the
                      // press move focus fires the wrapper's blur handler, closes
                      // the popover and the click never lands. Holding focus on
                      // the filter input keeps the popover alive.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(k)}
                    >
                      <span>{k}</span>
                      {added && <Check size={13} weight="bold" aria-label="già nello schema" />}
                    </button>
                  );
                })}
                {keys.length === 0 && <p className="hint">Nessuna chiave corrisponde al filtro.</p>}
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
            Incolla JSON
            <CaretDown size={12} weight="regular" />
          </button>
          {menu === "paste" && (
            <div className="popover">
              <textarea
                autoFocus
                rows={7}
                aria-label="Schema in formato JSON"
                placeholder={'{ "nome": "the first name of a person" }'}
                value={json}
                onChange={(e) => setJson(e.target.value)}
              />
              <div className="popfoot">
                <button className="btn" onClick={applyJson}>
                  Sostituisci tutti i campi
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
                placeholder="chiave"
                aria-label={`Chiave del campo ${i + 1}`}
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
                aria-label={`Descrizione del campo ${i + 1}`}
                ref={(el) => {
                  if (el) {
                    el.style.height = "0";
                    el.style.height = `${el.scrollHeight}px`;
                  }
                }}
                placeholder="che cosa significa questo campo"
                value={f.description}
                onChange={(e) => set(i, { ...f, description: e.target.value })}
                onKeyDown={(e) => onKeyDown(e, i, false)}
              />
              {f.key.trim() !== "" && !(f.key in SCHEMA) && (
                <span className="flag" title={UNTRAINED}>
                  <Warning size={13} weight="regular" />
                  chiave non addestrata
                </span>
              )}
            </div>
            <button
              className="icon-btn field-del"
              aria-label={`Rimuovi ${f.key.trim() === "" ? "il campo" : f.key}`}
              title={`Rimuovi ${f.key.trim() === "" ? "il campo" : f.key}`}
              onClick={() => remove(i)}
            >
              <Trash size={15} weight="regular" />
            </button>
          </div>
        ))}
        {fields.length === 0 && (
          <p className="hint">Nessun campo. Aggiungine uno per poter estrarre qualcosa.</p>
        )}
      </div>

      <button className="btn" onClick={() => addAfter(fields.length - 1)}>
        <Plus size={14} weight="regular" />
        Aggiungi campo
      </button>
    </section>
  );
}
