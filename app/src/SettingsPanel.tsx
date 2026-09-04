import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, Question, X } from "@phosphor-icons/react";
import SchemaEditor from "./SchemaEditor";
import LangPicker from "./LangPicker";
import { DICTS, useT } from "./i18n";
import { DEFAULT_SAMPLING } from "./types";
import type { DocLang, Field, Lang, Sampling } from "./types";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** The two the interface itself is written in, named in themselves. */
const INTERFACE_NAME: Record<Lang, string> = { en: "English", it: "Italiano" };

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
}

function Num({
  label,
  help,
  range,
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
  /** " From 0 to 2." — its own string, since word order is not universal. */
  range: string;
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
        {help}
        {range}
        {note}
      </span>
    </label>
  );
}

export default function SettingsPanel({
  fields,
  known,
  onFields,
  sampling,
  onSampling,
  lang,
  onLang,
  docLang,
  onDocLang,
  onClose,
}: {
  fields: Field[];
  /** Trained key → description, for the schema editor's presets. */
  known: Record<string, string>;
  onFields: (f: Field[]) => void;
  sampling: Sampling;
  onSampling: (s: Sampling) => void;
  lang: Lang;
  onLang: (l: Lang) => void;
  /** The language the documents are in, which the prompt is written in. */
  docLang: DocLang;
  onDocLang: (l: DocLang) => void;
  /** The caller closes the panel and puts focus back on the gear button. */
  onClose: () => void;
}) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  // The two halves of this drawer are unrelated: the schema is what you want
  // out, the model is how it decodes. Stacking them buried the model settings
  // under a schema that grows with every field, so they are tabs, not sections.
  const [tab, setTab] = useState<"schema" | "model">("schema");
  const greedy = sampling.temperature <= 0;
  const ignored = greedy ? t.ignoredAtZero : "";

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
        aria-label={t.settingsTitle}
        ref={panel}
      >
        <header className="drawer-head">
          <h2>{t.settingsTitle}</h2>
          <span className="grow" />
          {/* Two languages, both on screen. A menu hid half the answer, cost
              three interactions to change one of them, and — being the only
              <select> in here — was invisible to the drawer's own focus trap,
              which builds its tab ring from buttons and inputs. */}
          <div className="seg lang">
            {(Object.keys(DICTS) as Lang[]).map((l) => (
              <button
                key={l}
                aria-pressed={l === lang}
                aria-label={INTERFACE_NAME[l]}
                data-hint={INTERFACE_NAME[l]}
                onClick={() => onLang(l)}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            className="icon-btn drawer-close"
            aria-label={t.close}
            data-hint={t.close}
            onClick={onClose}
          >
            <X size={16} weight="regular" />
          </button>
        </header>

        <div className="drawer-tabs">
          <div className="seg">
            <button aria-pressed={tab === "schema"} onClick={() => setTab("schema")}>
              {t.schema}
            </button>
            <button aria-pressed={tab === "model"} onClick={() => setTab("model")}>
              {t.model}
            </button>
          </div>
          <span className="muted">
            {tab === "schema" ? t.fields(fields.length) : greedy ? t.greedy : t.sampling}
          </span>
        </div>

        <div className="drawer-body">
          {tab === "schema" && (
            <SchemaEditor
              fields={fields}
              known={known}
              kind="field"
              head={<LangPicker lang={docLang} onLang={onDocLang} label={t.docLanguage} hint={t.docLanguageHelp} />}
              onChange={onFields}
            />
          )}

          {tab === "model" && (
          <section className="group">
            <div className="group-head">
              <button
                className="help"
                aria-label={greedy ? t.greedyHelp : t.samplingHelp}
                data-hint={greedy ? t.greedyHelp : t.samplingHelp}
              >
                <Question size={14} weight="regular" />
              </button>
              <span className="grow" />
              <button
                className="btn"
                data-hint={t.resetModel}
                onClick={() => onSampling(DEFAULT_SAMPLING)}
              >
                <ArrowClockwise size={14} weight="regular" />
                {t.reset}
              </button>
            </div>

            <div className="settings">
              <Num
                label={t.temperature}
                help={t.temperatureHelp}
                range={t.range(0, 2)}
                value={sampling.temperature}
                min={0}
                max={2}
                step={0.05}
                onChange={(temperature) => onSampling({ ...sampling, temperature })}
              />
              <Num
                label={t.topK}
                help={t.topKHelp}
                range={t.range(0, 200)}
                note={ignored}
                off={greedy}
                value={sampling.topK}
                min={0}
                max={200}
                step={1}
                onChange={(topK) => onSampling({ ...sampling, topK })}
              />
              <Num
                label={t.topP}
                help={t.topPHelp}
                range={t.range(0, 1)}
                note={ignored}
                off={greedy}
                value={sampling.topP}
                min={0}
                max={1}
                step={0.05}
                onChange={(topP) => onSampling({ ...sampling, topP })}
              />
              <Num
                label={t.maxTokens}
                help={t.maxTokensHelp}
                range={t.range(16, 4096)}
                value={sampling.maxTokens}
                min={16}
                max={4096}
                step={16}
                onChange={(maxTokens) => onSampling({ ...sampling, maxTokens })}
              />
              <Num
                label={t.seed}
                help={t.seedHelp}
                range={t.range(0, 4294967295)}
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
