import { useState } from "react";
import { Copy, DownloadSimple, Eye, EyeSlash, Question, Warning } from "@phosphor-icons/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { isGrounded } from "./prompt";
import { REDACTED, shownResult } from "./redact";
import { useT } from "./i18n";
import type { Doc, Field } from "./types";

/**
 * The eye on a row. Leads it, so it sits in the same column in both views and
 * never wraps away from the value it hides.
 */
function EyeToggle({ hidden, name, onToggle }: { hidden: boolean; name: string; onToggle: () => void }) {
  const t = useT();
  // One name, whatever the state: aria-pressed says which, and a label that
  // flipped to "Show" while pressed would read as the opposite of the truth.
  const label = t.hideValue(name);
  return (
    <button
      className={hidden ? "icon-btn eye closed" : "icon-btn eye"}
      aria-label={label}
      aria-pressed={hidden}
      data-hint={hidden ? t.hiddenHelp : label}
      onClick={onToggle}
    >
      {hidden ? <EyeSlash size={14} weight="regular" /> : <Eye size={14} weight="regular" />}
    </button>
  );
}

/** A hidden value, drawn exactly as it leaves the app: the mask, not the value. */
function Masked({ name }: { name: string }) {
  const t = useT();
  return (
    <span className="jval redacted" aria-label={t.hiddenValue(name)}>
      {REDACTED}
    </span>
  );
}

/** Rate readout. Two significant figures is all the precision this number has. */
function Speed({ tps, live, help }: { tps: number; live: boolean; help: string }) {
  return (
    // No icon: "tok/s" already says what the number is, and the panel header
    // is the tightest row in the app.
    <span className={live ? "speed live" : "speed"} data-hint={help}>
      {tps.toFixed(tps < 10 ? 1 : 0)} tok/s
    </span>
  );
}

export default function Results({
  doc,
  fields,
  stream,
  speed,
  onEdit,
  onHover,
  onHide,
  notFound,
  onSettings,
}: {
  doc: Doc | null;
  fields: Field[];
  stream: string;
  /** Decode rate of the run in flight, or null when nothing is running. */
  speed: number | null;
  /** The JSON is editable, so a correction goes straight back to the document. */
  onEdit: (result: Record<string, string>) => void;
  /** The text the document pane should point at, or null on leave. */
  onHover: (value: string | null) => void;
  /** Opens or closes the eye on one field. */
  onHide: (key: string) => void;
  /** Hidden values that occur nowhere on the page, so nothing could be blacked out. */
  notFound: string[];
  /** Opens the settings drawer on the schema. */
  onSettings: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  // JSON is the default because the JSON is the deliverable. Fields is there
  // for reading the answer without the punctuation.
  const [view, setView] = useState<"json" | "fields">("json");

  const extracting = doc?.status === "extracting";
  const result = doc?.result;
  const lines = doc ? doc.pages.flatMap((p) => p.lines.map((l) => l.text)) : [];
  const hidden = new Set(fields.filter((f) => f.hidden).map((f) => f.key));
  // What Copy and Download hand over: exactly the rows on screen, hidden ones
  // masked. The raw output, when there is no parsed result, has nothing to tell
  // a hidden value apart by, so it is shown here but not handed over while any
  // field is hidden.
  const text = result ? JSON.stringify(shownResult(result, fields), null, 2) : (doc?.raw ?? "");
  const withheld = !result && hidden.size > 0;
  // Field order, not model order, so the same schema always reads the same way.
  const keys = result ? fields.map((f) => f.key).filter((k) => k in result) : [];
  const missing = result ? fields.filter((f) => !(f.key in result)).map((f) => f.key) : [];
  // Live while a run is in flight, then the rate that run finished at.
  const tps = extracting ? speed : (doc?.tps ?? null);

  async function copy() {
    setError("");
    try {
      await writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function download() {
    if (!doc) return;
    setError("");
    try {
      const path = await save({
        defaultPath: `${doc.name.replace(/\.[^.]+$/, "")}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path) await writeTextFile(path, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * At most one flag per row, and the louder one wins. A hidden value that is
   * not on the page is worse news than an invented one: it was meant to be
   * blacked out, and nothing on the page could be.
   */
  function flag(hidden: boolean, value: string) {
    if (hidden && notFound.includes(value)) {
      return (
        <span className="flag" data-hint={t.notBlackedOutHelp}>
          <Warning size={13} weight="regular" />
          {t.notBlackedOut}
        </span>
      );
    }
    if (isGrounded(value, lines)) return null;
    return (
      <span className="flag" data-hint={t.notOnPageHelp}>
        <Warning size={13} weight="regular" />
        {t.notOnPage}
      </span>
    );
  }

  function edit(key: string, value: string) {
    if (result) onEdit({ ...result, [key]: value });
  }

  return (
    <section className="panel json-pane">
      <header className="panel-head">
        <h2>{t.extraction}</h2>
        {/* The schema is what this panel is going to contain, so it is on screen
            before a run and it is the way in to editing it. */}
        <button
          className="link-btn"
          data-hint={t.openSchema}
          onClick={onSettings}
        >
          {t.schemaCount(fields.length)}
        </button>
        <span className="grow" />
        {tps !== null && <Speed tps={tps} live={extracting} help={t.speedHelp} />}
        {!extracting && result && (
          <>
            <button className="help" aria-label={t.valuesEditable} data-hint={t.valuesEditable}>
              <Question size={13} weight="regular" />
            </button>
            <div className="seg">
              <button aria-pressed={view === "fields"} onClick={() => setView("fields")}>
                {t.fieldsView}
              </button>
              <button aria-pressed={view === "json"} onClick={() => setView("json")}>
                {t.jsonView}
              </button>
            </div>
          </>
        )}
        {/* The two actions travel together. This header wraps rather than clips,
            and a lone download button on a second row reads as a mistake. */}
        {text !== "" && !extracting && (
          <span className="panel-actions">
            {copied && <span className="muted">{t.copied}</span>}
            {/* aria-disabled rather than disabled: WebKit sends no pointer
                events to a disabled button, and the hint is the explanation. */}
            <button
              className="icon-btn"
              aria-label={withheld ? t.rawWithheld : t.copyJson}
              aria-disabled={withheld || undefined}
              data-hint={withheld ? t.rawWithheld : t.copyJson}
              onClick={() => !withheld && copy()}
            >
              <Copy size={16} weight="regular" />
            </button>
            <button
              className="icon-btn"
              aria-label={withheld ? t.rawWithheld : t.downloadJson}
              aria-disabled={withheld || undefined}
              data-hint={withheld ? t.rawWithheld : t.downloadJson}
              onClick={() => !withheld && download()}
            >
              <DownloadSimple size={16} weight="regular" />
            </button>
          </span>
        )}
      </header>

      <div className="panel-body">
        {doc && doc.status === "failed" && doc.pages.length > 0 && (
          <p className="err">{t.extractFailed(doc.error ?? "")}</p>
        )}

        {doc && doc.raw !== undefined && !result && (
          <p className="err">{t.notJson}</p>
        )}

        {/* Nothing is drawn before a run: an empty object asserts an extraction
            that never happened. */}
        {!extracting && text === "" && (
          <>
            <p className="hint">
              {doc ? t.pressExtract : t.addThenExtract}
            </p>
            {/* A preview of the shape the run will return, so the panel is never
                a blank surface and the schema is legible without the drawer. */}
            {fields.length > 0 && (
              <div className="preview" aria-hidden="true">
                <div className="brace">{"{"}</div>
                {fields.map((f) => (
                  <div className="preview-row" key={f.key}>
                    {/* Which fields will come out masked, before there is anything to mask. */}
                    {f.hidden && <EyeSlash className="preview-eye" size={13} weight="regular" />}
                    <span className="jkey">"{f.key}"</span>
                    <span className="jpunct">:</span>
                    <span className="jghost">""</span>
                  </div>
                ))}
                <div className="brace">{"}"}</div>
              </div>
            )}
          </>
        )}

        {extracting && (
          <>
            <p className="hint">{t.modelReading}</p>
            {/* Set exactly like the JSON that replaces it, so finishing a run
                is a settle rather than a jump in size, colour and box. */}
            <pre className="raw streaming">
              {stream}
              <span className="caret" />
            </pre>
          </>
        )}

        {!extracting && result && view === "fields" && (
          <>
            <div className="fieldsview">
              {keys.map((key) => {
                const value = result[key];
                return (
                  <div
                    className="frow"
                    key={key}
                    onMouseEnter={() => onHover(value)}
                    onMouseLeave={() => onHover(null)}
                  >
                    <span className="flabel">
                      <EyeToggle hidden={hidden.has(key)} name={key} onToggle={() => onHide(key)} />
                      {key}
                    </span>
                    {hidden.has(key) ? (
                      <Masked name={key} />
                    ) : (
                      <input
                        className="jval fvalue"
                        aria-label={t.valueOf(key)}
                        value={value}
                        onChange={(e) => edit(key, e.target.value)}
                        onFocus={() => onHover(value)}
                        onBlur={() => onHover(null)}
                      />
                    )}
                    {flag(hidden.has(key), value)}
                  </div>
                );
              })}
            </div>
            {/* Two different warnings, kept apart: the flag above means a value
                came back that is not on the page, this means nothing came back
                at all. Fields only. The JSON stays what the model returned. */}
            {missing.length > 0 && (
              <section className="nofound">
                <h3>
                  <Warning size={14} weight="regular" />
                  {t.emptyFields(missing.length)}
                </h3>
                <p>{t.emptyFieldsHelp(missing.length)}</p>
                <ul>
                  {missing.map((key) => (
                    <li key={key}>{key}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {!extracting && result && view === "json" && (
          <>
            <div className="jsondoc">
              <div className="brace">{"{"}</div>
              {keys.map((key, i) => {
                const value = result[key];
                return (
                  <div
                    className="jrow"
                    key={key}
                    onMouseEnter={() => onHover(value)}
                    onMouseLeave={() => onHover(null)}
                  >
                    <EyeToggle hidden={hidden.has(key)} name={key} onToggle={() => onHide(key)} />
                    <span className="jkey">"{key}"</span>
                    <span className="jpunct">:</span>
                    <span className="jquote">"</span>
                    {hidden.has(key) ? (
                      <Masked name={key} />
                    ) : (
                      <input
                        className="jval"
                        aria-label={t.valueOf(key)}
                        value={value}
                        // A mono input sized to its text plus its own padding and
                        // border, so the JSON keeps its shape and nothing is clipped.
                        style={{ width: `calc(${Math.max(value.length, 3)}ch + 14px)` }}
                        onChange={(e) => edit(key, e.target.value)}
                        onFocus={() => onHover(value)}
                        onBlur={() => onHover(null)}
                      />
                    )}
                    {/* Closing quote and comma travel together, so a wrap never
                        strands a comma on a line of its own. */}
                    <span className="jquote">"{i < keys.length - 1 ? "," : ""}</span>
                    {flag(hidden.has(key), value)}
                  </div>
                );
              })}
              <div className="brace">{"}"}</div>
            </div>
          </>
        )}

        {!extracting && !result && text !== "" && <pre className="raw">{text}</pre>}
      </div>

      {error !== "" && (
        <footer className="panel-foot">
          <span className="err-text">{error}</span>
        </footer>
      )}
    </section>
  );
}
