import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, Question, X } from "@phosphor-icons/react";
import SchemaEditor from "./SchemaEditor";
import { DEFAULT_SAMPLING } from "./types";
import type { Field, Sampling } from "./types";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
}

function Num({
  label,
  help,
  value,
  min,
  max,
  step,
  note = "",
  off = false,
  onChange,
}: {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Appended after the range, for whatever else is true of this knob today. */
  note?: string;
  /** The current temperature makes this knob do nothing, so it is not live. */
  off?: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <label className={off ? "setting off" : "setting"}>
      <span className="setting-label">{label}</span>
      <input
        className="num"
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={off}
        // Free while typing, corrected on the way out: clamping every keystroke
        // makes "1024" impossible to type into a box whose floor is 16.
        onChange={(e) => onChange(Number(e.target.value))}
        onBlur={(e) => onChange(clamp(Number(e.target.value), min, max))}
      />
      {/* Every knob states its bounds: a value that silently snaps teaches nothing. */}
      <span className="setting-help">
        {help} Da {min} a {max}.{note}
      </span>
    </label>
  );
}

export default function SettingsPanel({
  fields,
  onFields,
  sampling,
  onSampling,
  onClose,
}: {
  fields: Field[];
  onFields: (f: Field[]) => void;
  sampling: Sampling;
  onSampling: (s: Sampling) => void;
  /** The caller closes the panel and puts focus back on the gear button. */
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // The two halves of this drawer are unrelated: the schema is what you want
  // out, the model is how it decodes. Stacking them buried the model settings
  // under a schema that grows with every field, so they are tabs, not sections.
  const [tab, setTab] = useState<"schema" | "modello">("schema");
  const greedy = sampling.temperature <= 0;
  const ignored = greedy ? " Ignorato finché la temperatura è 0." : "";

  // Focus the close button once, when the panel opens. This is deliberately its
  // own effect with no dependencies: onClose is a fresh closure on every App
  // render, so keying the focus call to it pulled the caret out of whatever
  // field you were typing in and onto the close button, one character at a time.
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>(".drawer-close")?.focus();
  }, []);

  useEffect(() => {
    const el = panel.current;
    if (!el) return;

    // Bubble phase, not capture: a popover inside the panel stops Escape from
    // reaching here, so Escape closes the popover first and the panel second.
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const first = items[0];
      const last = items[items.length - 1];
      if (!active || !el.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onMouseDown={onClose} />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Impostazioni di estrazione"
        ref={panel}
      >
        <header className="drawer-head">
          <h2>Impostazioni di estrazione</h2>
          <span className="grow" />
          <button
            className="icon-btn drawer-close"
            aria-label="Chiudi le impostazioni di estrazione"
            title="Chiudi"
            onClick={onClose}
          >
            <X size={16} weight="regular" />
          </button>
        </header>

        <div className="drawer-tabs">
          <div className="seg">
            <button aria-pressed={tab === "schema"} onClick={() => setTab("schema")}>
              Schema
            </button>
            <button aria-pressed={tab === "modello"} onClick={() => setTab("modello")}>
              Modello
            </button>
          </div>
          <span className="muted">
            {tab === "schema"
              ? `${fields.length} ${fields.length === 1 ? "campo" : "campi"}`
              : greedy
                ? "decodifica greedy"
                : "campionamento attivo"}
          </span>
        </div>

        <div className="drawer-body">
          {tab === "schema" && <SchemaEditor fields={fields} onChange={onFields} />}

          {tab === "modello" && (
          <section className="group">
            <div className="group-head">
              <span
                className="help"
                title={
                  greedy
                    ? "Temperatura 0, quindi l'esecuzione è deterministica: stesso documento e stesso schema danno sempre la stessa risposta."
                    : "Il campionamento è attivo, quindi due esecuzioni sullo stesso documento possono differire. Il seed rende ripetibile una esecuzione."
                }
              >
                <Question size={14} weight="regular" />
              </span>
              <span className="grow" />
              <button
                className="btn"
                title="Ripristina i valori predefiniti del modello"
                onClick={() => onSampling(DEFAULT_SAMPLING)}
              >
                <ArrowClockwise size={14} weight="regular" />
                Ripristina
              </button>
            </div>

            <div className="settings">
              <Num
                label="Temperatura"
                help="0 significa deterministico. Valori più alti lasciano divagare il modello."
                value={sampling.temperature}
                min={0}
                max={2}
                step={0.05}
                onChange={(temperature) => onSampling({ ...sampling, temperature })}
              />
              <Num
                label="Top-k"
                help="0 la disattiva. Altrimenti considera solo i k token più probabili."
                note={ignored}
                off={greedy}
                value={sampling.topK}
                min={0}
                max={200}
                step={1}
                onChange={(topK) => onSampling({ ...sampling, topK })}
              />
              <Num
                label="Top-p"
                help="1 lo disattiva. Altrimenti taglia i token meno probabili."
                note={ignored}
                off={greedy}
                value={sampling.topP}
                min={0}
                max={1}
                step={0.05}
                onChange={(topP) => onSampling({ ...sampling, topP })}
              />
              <Num
                label="Token massimi"
                help="La risposta più lunga che il modello può scrivere."
                value={sampling.maxTokens}
                min={16}
                max={4096}
                step={16}
                onChange={(maxTokens) => onSampling({ ...sampling, maxTokens })}
              />
              <Num
                label="Seed"
                help="Fissa l'estrazione casuale, così una esecuzione campionata è ripetibile."
                note={ignored}
                off={greedy}
                value={sampling.seed}
                min={0}
                max={4294967295}
                step={1}
                onChange={(seed) => onSampling({ ...sampling, seed })}
              />
            </div>
          </section>
          )}
        </div>
      </div>
    </>
  );
}
