import { useEffect, useRef, useState } from "react";
import { ArrowRight, Gear, Play, WarningCircle, X } from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { backendStatus, extract, inTauri } from "./api";
import { loadPages } from "./pdf";
import { DEFAULT_PREFS, loadDocs, loadPrefs, saveDocs, savePrefs } from "./store";
import { buildPrompt, parseAnswer, parseClass } from "./prompt";
import { classesFor, defaultClasses, defaultFields, schemaFor } from "./catalog";
import { DICTS, Words } from "./i18n";
import Logo from "./Logo";
import Sidebar from "./Sidebar";
import DocumentPane from "./DocumentPane";
import SettingsPanel from "./SettingsPanel";
import Results from "./Results";
import { CLASSIFY_SAMPLING, DEFAULT_SAMPLING } from "./types";
import type { Dict } from "./i18n";
import type { Doc, Field, Lang, Page, Sampling, Status } from "./types";

/** Classification streams into nothing: one short object, no live view of it. */
const noop = () => {};

const EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp", "tif", "tiff"];

/** Same array identity on every render, so the store effect can tell "not touched yet". */
const INITIAL: Doc[] = [];

/** Every state gets a dot; only the working ones pulse. */
function dotClass(s: Status): string {
  if (s === "reading" || s === "extracting" || s === "classifying") return "dot busy";
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
  t: Dict,
  doc: Doc | null,
  fields: Field[],
  backend: { ok: boolean; detail: string } | null,
): string {
  if (!doc) return t.needDocument;
  if (doc.status === "reading") return t.stillReading;
  if (doc.status === "classifying") return t.stillClassifying;
  if (doc.status === "extracting") return t.alreadyExtracting;
  if (doc.pages.every((p) => p.lines.length === 0)) return t.noText;
  if (fields.length === 0) return t.needField;
  if (fields.some((f) => f.key.trim() === "")) return t.needKey;
  // The banner already carries the detail; the button just says it cannot run.
  if (!inTauri) return t.noDevServer;
  if (backend && !backend.ok) return t.noModel;
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
  const [lang, setLang] = useState<Lang>(DEFAULT_PREFS.lang);
  const [classify, setClassify] = useState(DEFAULT_PREFS.classify);
  const [classes, setClasses] = useState<Field[]>(DEFAULT_PREFS.classes);
  // The schema belongs to what you want, not to a file, so it exists before any
  // document does and a new document inherits whatever is on screen. Sampling
  // works the same way.
  const [draft, setDraft] = useState<Field[]>(() => defaultFields(DEFAULT_PREFS.lang));
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

  const t = DICTS[lang];
  const doc = docs.find((d) => d.id === activeId) ?? null;
  const fields = doc ? doc.fields : draft;
  const sampling = doc ? (doc.sampling ?? DEFAULT_SAMPLING) : draftSampling;

  // The drag listener is registered once, so it reads the live values here.
  const newDocDefaults = useRef({ fields, sampling });
  newDocDefaults.current = { fields, sampling };
  // addPath runs from a listener registered once, so the classification
  // settings have to be read at call time, not captured at mount.
  const classifier = useRef({ classify, classes });
  classifier.current = { classify, classes };
  // Same reason: the drop handler needs the current words, not the ones that
  // were on screen when it was registered.
  const words = useRef(t);
  words.current = t;

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
    loadPrefs().then((p) => {
      setLang(p.lang);
      setClassify(p.classify);
      setClasses(p.classes);
      // The draft schema is the English preset and nobody has touched it yet,
      // so it becomes the stored language's preset rather than staying a mix.
      if (p.lang !== DEFAULT_PREFS.lang) {
        setDraft((cur) =>
          sameKeys(cur, defaultFields(DEFAULT_PREFS.lang)) ? defaultFields(p.lang) : cur,
        );
      }
    });
    // Empty detail means "one of ours": the words are chosen at render time,
    // since this resolves before the stored language does. A detail with text
    // in it came from Rust and names a missing file.
    if (!inTauri) {
      setBackend({ ok: false, detail: "" });
      return;
    }
    backendStatus().then(setBackend, (e) => {
      // The raw exception names an internal API and helps nobody on screen.
      console.error("backend_status failed", e);
      setBackend({ ok: false, detail: "" });
    });
  }, []);

  // Hyphenation and screen readers both read this, and it is wrong the moment
  // the language changes without it.
  useEffect(() => {
    document.documentElement.lang = t.htmlLang;
  }, [t]);

  // Pages carry base64 images, so a store write is megabytes. Debounce it, and
  // skip the copy that just came off disk. Streaming tokens live in `stream`,
  // not in `docs`, so they never trigger a write.
  useEffect(() => {
    if (docs === disk.current) return;
    const t = setTimeout(() => void saveDocs(docs), 400);
    return () => clearTimeout(t);
  }, [docs]);

  function changeLanguage(next: Lang) {
    // An untouched list follows the language, an edited one does not: the
    // second is work someone did, and silently replacing it loses it.
    const nextClasses = sameKeys(classes, defaultClasses(lang))
      ? defaultClasses(next)
      : classes;
    setLang(next);
    setClasses(nextClasses);
    void savePrefs({ lang: next, classify, classes: nextClasses });
    if (sameKeys(fields, defaultFields(lang))) setFields(defaultFields(next));
  }

  function changeClassify(next: boolean) {
    setClassify(next);
    void savePrefs({ lang, classify: next, classes });
  }

  function changeClasses(next: Field[]) {
    setClasses(next);
    void savePrefs({ lang, classify, classes: next });
  }

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
    setProgress(words.current.readingFile);
    let pages;
    try {
      pages = await loadPages(path, setProgress, words.current);
    } catch (e) {
      patch(id, { status: "failed", error: message(e) });
      return;
    } finally {
      setProgress("");
    }
    await classifyDoc(id, pages);
  }

  /**
   * Ask the model what kind of document this is, once, on open.
   *
   * Unlike extraction there is nothing to set up first — the class list is the
   * same for every document — so waiting for a button press buys nothing. A
   * failure here is not the document's failure: it still opens, and it still
   * extracts. It just opens without a class.
   */
  async function classifyDoc(id: string, pages: Page[]) {
    const { classify, classes } = classifier.current;
    const lines = pages.flatMap((p) => p.lines.map((l) => l.text));
    if (!classify || classes.length === 0 || lines.length === 0 || !inTauri) {
      patch(id, { pages, status: "ready" });
      return;
    }
    patch(id, { pages, status: "classifying" });
    try {
      const raw = await extract(buildPrompt("classify", classes, lines), CLASSIFY_SAMPLING, noop);
      patch(id, { status: "ready", docClass: parseClass(raw, classes) ?? undefined });
    } catch (e) {
      console.error("classification failed", e);
      patch(id, { status: "ready" });
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
          setDropError(path ? "" : words.current.unsupported(EXTENSIONS));
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
        filters: [{ name: t.documentsFilter, extensions: EXTENSIONS }],
      });
      if (typeof path === "string") {
        setDropError("");
        await addPath(path);
      }
    } catch (e) {
      console.error("file dialog failed", e);
      setDropError(inTauri ? t.pickerFailed(message(e)) : t.noTauri);
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
      const raw = await extract(buildPrompt("extract", doc.fields, lines), sampling, (piece) => {
        acc += piece;
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
  const reason = blocker(t, doc, fields, backend);
  const modelDown = !inTauri || (backend !== null && !backend.ok);
  const statusText = status === "ready" && modelDown ? t.modelUnavailable : t.statusLabel[status];

  return (
    <Words.Provider value={t}>
      <div className="app">
        <header className="topbar" data-tauri-drag-region>
          <span className="brand">
            <Logo size={19} />
            Scrivano
            {/* A 350M model on eight languages. Say so where it cannot be missed. */}
            <span className="beta" title={t.betaTitle}>
              beta
            </span>
          </span>
          {doc && (
            <span className="topbar-doc" title={doc.name}>
              {doc.name}
            </span>
          )}
          {/* The class travels with the document name, so it is on screen with
              the rail collapsed too. Nothing is drawn before an answer: an
              empty tag would read as a class the model chose. */}
          {doc?.docClass !== undefined && <span className="tag">{doc.docClass}</span>}
          <span className={`pill status-${status}`}>
            <i className={dotClass(status)} />
            {/* "Ready" next to a button saying the model cannot run is a lie, and
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
            title={reason === "" ? t.runExtraction : reason}
            onClick={runExtract}
          >
            <Play size={14} weight="fill" />
            {status === "extracting" ? t.extracting : t.extract}
          </button>
          <button
            ref={gearRef}
            className="btn"
            aria-expanded={settings}
            title={t.settingsTitle}
            onClick={() => setSettings(true)}
          >
            <Gear size={16} weight="regular" />
            {t.settings}
          </button>
        </header>

        {backend && !backend.ok && !hushed && (
          <div className="banner" role="alert">
            <WarningCircle size={16} weight="regular" />
            <span className="grow">
              {backend.detail || (inTauri ? t.backendDown : t.noTauri)}
            </span>
            <button
              className="icon-btn"
              aria-label={t.dismissWarning}
              title={t.close}
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
            known={schemaFor(lang)}
            onFields={setFields}
            sampling={sampling}
            onSampling={setSampling}
            lang={lang}
            onLang={changeLanguage}
            classify={classify}
            onClassify={changeClassify}
            classes={classes}
            trainedClasses={classesFor(lang)}
            onClasses={changeClasses}
            onClose={closeSettings}
          />
        )}
      </div>
    </Words.Provider>
  );
}

/** Two schemas naming the same keys in the same order: nobody has edited this one. */
function sameKeys(a: Field[], b: Field[]): boolean {
  return a.length === b.length && a.every((f, i) => f.key === b[i].key);
}
