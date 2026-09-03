import { useState } from "react";
import { Copy, DownloadSimple, Gauge, Question, Warning } from "@phosphor-icons/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { isGrounded } from "./prompt";
import type { Doc, Field } from "./types";

const NOT_ON_PAGE =
  "Questo testo non compare da nessuna parte nel documento, quindi il modello lo ha probabilmente inventato.";

const SPEED_HELP =
  "Velocità di generazione del modello, token al secondo. Misurata dal primo token, quindi non include la lettura del prompt.";

/** Rate readout. Two significant figures is all the precision this number has. */
function Speed({ tps, live }: { tps: number; live: boolean }) {
  return (
    <span className={live ? "speed live" : "speed"} title={SPEED_HELP}>
      <Gauge size={13} weight="regular" />
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
  /** Opens the settings drawer on the schema. */
  onSettings: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  // JSON is the default because the JSON is the deliverable. Fields is there
  // for reading the answer without the punctuation.
  const [view, setView] = useState<"json" | "fields">("json");

  const extracting = doc?.status === "extracting";
  const result = doc?.result;
  const lines = doc ? doc.pages.flatMap((p) => p.lines.map((l) => l.text)) : [];
  const text = result ? JSON.stringify(result, null, 2) : (doc?.raw ?? "");
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

  function edit(key: string, value: string) {
    if (result) onEdit({ ...result, [key]: value });
  }

  return (
    <section className="panel json-pane">
      <header className="panel-head">
        <h2>Estrazione</h2>
        {/* The schema is what this panel is going to contain, so it is on screen
            before a run and it is the way in to editing it. */}
        <button
          className="link-btn"
          title="Apri lo schema nelle impostazioni di estrazione"
          onClick={onSettings}
        >
          Schema &middot; {fields.length} {fields.length === 1 ? "campo" : "campi"}
        </button>
        <span className="grow" />
        {tps !== null && <Speed tps={tps} live={extracting} />}
        {!extracting && result && (
          <>
            <span
              className="help"
              title="I valori sono modificabili. Passa il puntatore su uno per trovarlo nel testo del documento."
            >
              <Question size={13} weight="regular" />
            </span>
            <div className="seg">
              <button aria-pressed={view === "fields"} onClick={() => setView("fields")}>
                Campi
              </button>
              <button aria-pressed={view === "json"} onClick={() => setView("json")}>
                JSON
              </button>
            </div>
          </>
        )}
        {text !== "" && (
          <>
            {copied && <span className="muted">Copiato</span>}
            <button className="icon-btn" aria-label="Copia il JSON" title="Copia il JSON" onClick={copy}>
              <Copy size={16} weight="regular" />
            </button>
            <button
              className="icon-btn"
              aria-label="Scarica il JSON"
              title="Scarica il JSON"
              onClick={download}
            >
              <DownloadSimple size={16} weight="regular" />
            </button>
          </>
        )}
      </header>

      <div className="panel-body">
        {doc && doc.status === "failed" && doc.pages.length > 0 && (
          <p className="err">Estrazione fallita: {doc.error}</p>
        )}

        {doc && doc.raw !== undefined && !result && (
          <p className="err">Il modello non ha restituito un JSON valido. Qui sotto l'output grezzo.</p>
        )}

        {/* Nothing is drawn before a run: an empty object asserts an extraction
            that never happened. */}
        {!extracting && text === "" && (
          <>
            <p className="hint">
              {doc
                ? "Premi Estrai per riempire lo schema con i dati di questo documento."
                : "Aggiungi un documento, poi premi Estrai."}
            </p>
            {/* A preview of the shape the run will return, so the panel is never
                a blank surface and the schema is legible without the drawer. */}
            {fields.length > 0 && (
              <div className="preview" aria-hidden="true">
                <div className="brace">{"{"}</div>
                {fields.map((f) => (
                  <div className="preview-row" key={f.key}>
                    <span className="jkey">"{f.key}"</span>
                    <span>:</span>
                  </div>
                ))}
                <div className="brace">{"}"}</div>
              </div>
            )}
          </>
        )}

        {extracting && (
          <>
            <p className="hint">Il modello sta leggendo il documento.</p>
            <pre className="raw">
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
                    <span className="flabel">{key}</span>
                    <input
                      className="jval fvalue"
                      aria-label={`Valore di ${key}`}
                      value={value}
                      onChange={(e) => edit(key, e.target.value)}
                      onFocus={() => onHover(value)}
                      onBlur={() => onHover(null)}
                    />
                    {!isGrounded(value, lines) && (
                      <span className="flag" title={NOT_ON_PAGE}>
                        <Warning size={13} weight="regular" />
                        non nel documento
                      </span>
                    )}
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
                  {missing.length} {missing.length === 1 ? "campo senza valore" : "campi senza valore"}
                </h3>
                <p>
                  Il modello non ha restituito nulla per{" "}
                  {missing.length === 1 ? "questa chiave" : "queste chiavi"}, quindi{" "}
                  {missing.length === 1 ? "è assente" : "sono assenti"} dal JSON.
                </p>
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
                const grounded = isGrounded(value, lines);
                return (
                  <div
                    className="jrow"
                    key={key}
                    onMouseEnter={() => onHover(value)}
                    onMouseLeave={() => onHover(null)}
                  >
                    <span className="jkey">"{key}"</span>
                    <span className="jpunct">:</span>
                    <span className="jquote">"</span>
                    <input
                      className="jval"
                      aria-label={`Valore di ${key}`}
                      value={value}
                      // A mono input sized to its text plus its own padding and
                      // border, so the JSON keeps its shape and nothing is clipped.
                      style={{ width: `calc(${Math.max(value.length, 3)}ch + 14px)` }}
                      onChange={(e) => edit(key, e.target.value)}
                      onFocus={() => onHover(value)}
                      onBlur={() => onHover(null)}
                    />
                    {/* Closing quote and comma travel together, so a wrap never
                        strands a comma on a line of its own. */}
                    <span className="jquote">"{i < keys.length - 1 ? "," : ""}</span>
                    {!grounded && (
                      <span className="flag" title={NOT_ON_PAGE}>
                        <Warning size={13} weight="regular" />
                        non nel documento
                      </span>
                    )}
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
