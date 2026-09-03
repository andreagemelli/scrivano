import { useEffect, useRef, useState } from "react";
import { ArrowRight, Gear, Play, WarningCircle, X } from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { backendStatus, extract, inTauri } from "./api";
import { loadPages } from "./pdf";
import { loadDocs, saveDocs } from "./store";
import { buildPrompt, parseAnswer } from "./prompt";
import Logo from "./Logo";
import Sidebar from "./Sidebar";
import DocumentPane from "./DocumentPane";
import { defaultFields } from "./SchemaEditor";
import SettingsPanel from "./SettingsPanel";
import Results from "./Results";
import { DEFAULT_SAMPLING } from "./types";
import type { Doc, Field, Sampling, Status } from "./types";

const EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp", "tif", "tiff"];

const BACKEND_DOWN = "Il modello di estrazione non risponde. Riavvia Scrivano e riprova.";

const NO_TAURI =
  "Questo è il server di sviluppo del browser: apertura dei file, OCR e modello non sono disponibili. Avvia invece npm run tauri dev.";

/** Same array identity on every render, so the store effect can tell "not touched yet". */
const INITIAL: Doc[] = [];

const STATUS_LABEL: Record<Status, string> = {
  empty: "Nessun documento",
  reading: "Lettura",
  ready: "Pronto",
  extracting: "Estrazione",
  done: "Completato",
  failed: "Errore",
};

/** Every state gets a dot; only the two working ones pulse. */
function dotClass(s: Status): string {
  if (s === "reading" || s === "extracting") return "dot busy";
  if (s === "failed") return "dot failed";
  return "dot";
}

function accepted(path: string): boolean {
  return EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? "");
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Empty string means the Extract button is live. */
function blocker(
  doc: Doc | null,
  fields: Field[],
  backend: { ok: boolean; detail: string } | null,
): string {
  if (!doc) return "Aggiungi prima un documento";
  if (doc.status === "reading") return "Lettura del documento in corso";
  if (doc.status === "extracting") return "Estrazione già in corso";
  if (doc.pages.every((p) => p.lines.length === 0))
    return "Nessun testo trovato in questo documento";
  if (fields.length === 0) return "Aggiungi almeno un campo";
  if (fields.some((f) => f.key.trim() === "")) return "Ogni campo deve avere una chiave";
  // The banner already carries the detail; the button just says it cannot run.
  if (!inTauri) return "Non disponibile nel server di sviluppo del browser";
  if (backend && !backend.ok) return "Il modello di estrazione non è disponibile";
  return "";
}

/** Session storage, because a private window or a locked-down webview can throw. */
function railFromSession(): boolean {
  try {
    return sessionStorage.getItem("rail") !== "collapsed";
  } catch {
    return true;
  }
}

export default function App() {
  const [docs, setDocs] = useState<Doc[]>(INITIAL);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [stream, setStream] = useState("");
  // Live decode rate of the run in flight, or null between runs. A finished run
  // keeps its rate on the document instead, so history still reports it.
  const [speed, setSpeed] = useState<number | null>(null);
  const [backend, setBackend] = useState<{ ok: boolean; detail: string } | null>(null);
  // The schema belongs to what you want, not to a file, so it exists before any
  // document does and a new document inherits whatever is on screen. Sampling
  // works the same way.
  const [draft, setDraft] = useState<Field[]>(defaultFields);
  const [draftSampling, setDraftSampling] = useState<Sampling>(DEFAULT_SAMPLING);
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState("");
  const [hushed, setHushed] = useState(false);
  const [railOpen, setRailOpen] = useState(railFromSession);
  const [settings, setSettings] = useState(false);
  // The text the JSON pane is pointing at, or null. Read by the document pane.
  const [highlight, setHighlight] = useState<string | null>(null);
  const disk = useRef<Doc[]>(INITIAL);
  const gearRef = useRef<HTMLButtonElement>(null);

  const doc = docs.find((d) => d.id === activeId) ?? null;
  const fields = doc ? doc.fields : draft;
  const sampling = doc ? (doc.sampling ?? DEFAULT_SAMPLING) : draftSampling;

  // The drag listener is registered once, so it reads the live values here.
  const newDocDefaults = useRef({ fields, sampling });
  newDocDefaults.current = { fields, sampling };

  useEffect(() => {
    loadDocs().then((d) => {
      disk.current = d;
      // History can be megabytes of base64 page images, so this resolves well
      // after the first paint. A document dropped in that window is already in
      // state, and assigning the disk copy over it threw it away silently, so
      // the two are merged and whatever is on screen keeps the selection.
      setDocs((cur) => (cur === INITIAL ? d : [...cur, ...d]));
      setActiveId((cur) => cur ?? d[0]?.id ?? null);
    });
    if (!inTauri) {
      setBackend({ ok: false, detail: NO_TAURI });
      return;
    }
    backendStatus().then(setBackend, (e) => {
      // The raw exception names an internal API and helps nobody on screen.
      console.error("backend_status failed", e);
      setBackend({ ok: false, detail: BACKEND_DOWN });
    });
  }, []);

  // Pages carry base64 images, so a store write is megabytes. Debounce it, and
  // skip the copy that just came off disk. Streaming tokens live in `stream`,
  // not in `docs`, so they never trigger a write.
  useEffect(() => {
    if (docs === disk.current) return;
    const t = setTimeout(() => void saveDocs(docs), 400);
    return () => clearTimeout(t);
  }, [docs]);

  function toggleRail() {
    setRailOpen((open) => {
      try {
        sessionStorage.setItem("rail", open ? "collapsed" : "open");
      } catch {
        // Not remembering the rail is not worth failing the click over.
      }
      return !open;
    });
  }

  function closeSettings() {
    setSettings(false);
    gearRef.current?.focus();
  }

  const patch = (id: string, p: Partial<Doc>) =>
    setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, ...p } : d)));

  async function addPath(path: string) {
    const id = crypto.randomUUID();
    setDocs((ds) => [
      {
        id,
        name: path.split(/[\\/]/).pop() ?? path,
        addedAt: Date.now(),
        pages: [],
        fields: newDocDefaults.current.fields,
        sampling: newDocDefaults.current.sampling,
        status: "reading",
      },
      ...ds,
    ]);
    setActiveId(id);
    setProgress("Lettura del file");
    try {
      const pages = await loadPages(path, setProgress);
      patch(id, { pages, status: "ready" });
    } catch (e) {
      patch(id, { status: "failed", error: message(e) });
    } finally {
      setProgress("");
    }
  }

  // Tauri delivers dropped paths on the webview, not through HTML drag events.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    // Outside Tauri there is no webview to subscribe to, and getCurrentWebview
    // throws rather than rejecting, so the guard has to be a try.
    try {
      void getCurrentWebview()
        .onDragDropEvent((e) => {
          if (e.payload.type === "enter" || e.payload.type === "over") {
            setDragging(true);
            return;
          }
          setDragging(false);
          if (e.payload.type !== "drop") return;
          const path = e.payload.paths.find(accepted);
          setDropError(path ? "" : `File non supportato. Usa ${EXTENSIONS.join(", ")}.`);
          if (path) void addPath(path);
        })
        .then((un) => {
          if (gone) un();
          else stop = un;
        });
    } catch {
      // Drag and drop is simply unavailable here.
    }
    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  async function pickDocument() {
    // Without this the dialog rejection is unhandled and the button looks dead.
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Documenti", extensions: EXTENSIONS }],
      });
      if (typeof path === "string") {
        setDropError("");
        await addPath(path);
      }
    } catch (e) {
      console.error("file dialog failed", e);
      setDropError(
        inTauri ? `Impossibile aprire la finestra di selezione. ${message(e)}` : NO_TAURI,
      );
    }
  }

  function removeDocument(id: string) {
    setDocs((ds) => ds.filter((d) => d.id !== id));
    if (id === activeId) setActiveId(docs.find((d) => d.id !== id)?.id ?? null);
  }

  function setFields(next: Field[]) {
    if (doc) patch(doc.id, { fields: next });
    else setDraft(next);
  }

  function setSampling(next: Sampling) {
    if (doc) patch(doc.id, { sampling: next });
    else setDraftSampling(next);
  }

  async function runExtract() {
    if (!doc) return;
    const { id } = doc;
    const lines = doc.pages.flatMap((p) => p.lines.map((l) => l.text));
    patch(id, {
      status: "extracting",
      raw: undefined,
      result: undefined,
      error: undefined,
      tps: undefined,
    });
    setStream("");
    setSpeed(null);
    setHighlight(null);
    // Decode rate, measured from the first token: everything before it is
    // prompt processing, and counting that would report a speed the model is
    // not running at. One "token" event is one token, so counting them is exact.
    let started = 0;
    let n = 0;
    let tps: number | undefined;
    try {
      let acc = "";
      const raw = await extract(buildPrompt(doc.fields, lines), sampling, (t) => {
        acc += t;
        setStream(acc);
        if (n === 0) started = performance.now();
        n++;
        const elapsed = (performance.now() - started) / 1000;
        // Under a quarter second the rate is mostly measurement noise.
        if (elapsed >= 0.25) {
          tps = (n - 1) / elapsed;
          setSpeed(tps);
        }
      });
      patch(id, { status: "done", raw, result: parseAnswer(raw, doc.fields) ?? undefined, tps });
    } catch (e) {
      patch(id, { status: "failed", error: message(e) });
    } finally {
      setStream("");
      setSpeed(null);
    }
  }

  const status: Status = doc?.status ?? "empty";
  const reason = blocker(doc, fields, backend);
  const modelDown = !inTauri || (backend !== null && !backend.ok);
  const statusText = status === "ready" && modelDown ? "Modello non disponibile" : STATUS_LABEL[status];

  return (
    <div className="app">
      <header className="topbar" data-tauri-drag-region>
        <span className="brand">
          <Logo size={19} />
          Scrivano
          {/* One fine-tune on 149 documents. Say so where it cannot be missed. */}
          <span className="beta" title="Versione beta: il modello è ancora in evoluzione.">
            beta
          </span>
        </span>
        {doc && (
          <span className="topbar-doc" title={doc.name}>
            {doc.name}
          </span>
        )}
        <span className={`pill status-${status}`}>
          <i className={dotClass(status)} />
          {/* "Pronto" next to a button saying the model cannot run is a lie, and
              the chip is the louder of the two. Say the thing that blocks. */}
          {statusText}
        </span>
        <span className="grow" />
        {reason !== "" && (
          <span className="reason" title={reason}>
            {reason}
          </span>
        )}
        <button
          className="btn primary"
          disabled={reason !== ""}
          title={reason === "" ? "Avvia l'estrazione" : reason}
          onClick={runExtract}
        >
          <Play size={14} weight="fill" />
          {status === "extracting" ? "Estrazione…" : "Estrai"}
        </button>
        <button
          ref={gearRef}
          className="btn"
          aria-expanded={settings}
          title="Impostazioni di estrazione"
          onClick={() => setSettings(true)}
        >
          <Gear size={16} weight="regular" />
          Impostazioni
        </button>
      </header>

      {backend && !backend.ok && !hushed && (
        <div className="banner" role="alert">
          <WarningCircle size={16} weight="regular" />
          <span className="grow">{backend.detail}</span>
          <button
            className="icon-btn"
            aria-label="Chiudi l'avviso"
            title="Chiudi"
            onClick={() => setHushed(true)}
          >
            <X size={14} weight="regular" />
          </button>
        </div>
      )}

      <div className="workspace">
        <Sidebar
          docs={docs}
          activeId={activeId}
          open={railOpen}
          onToggle={toggleRail}
          onSelect={setActiveId}
          onAdd={pickDocument}
          onDelete={removeDocument}
        />

        <main className="stage">
          <DocumentPane
            doc={doc}
            progress={progress}
            dragging={dragging}
            dropError={dropError}
            highlight={highlight}
            onAdd={pickDocument}
          />
          {/* Source on the left, output on the right. */}
          <div className="flow" aria-hidden="true">
            <ArrowRight size={18} weight="bold" />
          </div>
          <Results
            doc={doc}
            fields={fields}
            stream={stream}
            speed={speed}
            onEdit={(result) => doc && patch(doc.id, { result })}
            onHover={setHighlight}
            onSettings={() => setSettings(true)}
          />
        </main>
      </div>

      {settings && (
        <SettingsPanel
          fields={fields}
          onFields={setFields}
          sampling={sampling}
          onSampling={setSampling}
          onClose={closeSettings}
        />
      )}
    </div>
  );
}
