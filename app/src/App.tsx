import { useEffect, useRef, useState } from "react";
import { ArrowRight, Gear, Play, Tag as TagIcon, WarningCircle, X } from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { backendStatus, extract, inTauri } from "./api";
import { loadPages } from "./pdf";
import { DEFAULT_PREFS, FIRST_PROJECT, loadDocs, loadPrefs, saveDocs, savePrefs } from "./store";
import { buildPrompt, parseAnswer, parseClass } from "./prompt";
import { hiddenValues, locate } from "./redact";
import { classAlias, classesFor, defaultClasses, defaultFields, schemaFor } from "./catalog";
import { DICTS, Words } from "./i18n";
import Hints from "./Hints";
import Logo from "./Logo";
import Sidebar from "./Sidebar";
import DocumentPane from "./DocumentPane";
import SettingsPanel from "./SettingsPanel";
import ProjectPanel from "./ProjectPanel";
import Results from "./Results";
import { CLASSIFY_SAMPLING, DEFAULT_SAMPLING } from "./types";
import type { Dict } from "./i18n";
import type { Doc, DocLang, Field, Lang, Page, Project, Sampling, Status } from "./types";

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
  const [projects, setProjects] = useState<Project[]>(DEFAULT_PREFS.projects);
  const [projectId, setProjectId] = useState(DEFAULT_PREFS.activeProjectId);
  const [editingProject, setEditingProject] = useState(false);
  // The schema belongs to what you want, not to a file, so it exists before any
  // document does and a new document inherits whatever is on screen. Sampling
  // works the same way.
  const [draft, setDraft] = useState<Field[]>(() => defaultFields(DEFAULT_PREFS.projects[0].docLang));
  /** The draft's language: what the next document in this folder starts from. */
  const [draftLang, setDraftLang] = useState<DocLang>(DEFAULT_PREFS.projects[0].docLang);
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
  // Documents saved before projects existed belong to the first one, which is
  // also where a deleted project's documents go: there is always a home.
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const inProject = docs.filter((d) => projectOf(d) === project.id);
  const doc = inProject.find((d) => d.id === activeId) ?? null;
  // The language of what is on screen: this document's own if it has one, the
  // folder's otherwise. Everything the drawer shows — presets, the untrained
  // flag — reads it, and so does the next extraction.
  const docLang = doc?.docLang ?? (doc ? project.docLang : draftLang);
  const counts = Object.fromEntries(
    projects.map((p) => [p.id, docs.filter((d) => projectOf(d) === p.id).length]),
  );
  const fields = doc ? doc.fields : draft;
  const sampling = doc ? (doc.sampling ?? DEFAULT_SAMPLING) : draftSampling;
  // Where the hidden values sit on the page. Both panes read the same answer,
  // so the JSON never claims a value is blacked out that the page still shows.
  const hiding = doc ? hiddenValues(doc.fields, doc.result) : [];
  const located = doc && hiding.length > 0 ? locate(doc.pages, hiding) : { spans: [], missing: [] };
  // A field is hidden but there is no extraction to take its value from — none
  // yet, one in flight, or one that failed — so nothing can be blacked out, and
  // nothing the document pane would export is safe to hand over.
  const unsettled = doc !== null && doc.result === undefined && doc.fields.some((f) => f.hidden);

  // The drag listener is registered once, so everything addPath needs is read
  // through refs at call time rather than captured at mount.
  //
  // A new document inherits the DRAFT schema, not the selected document's. They
  // used to be the same value, which meant selecting an old document quietly
  // made its schema the template for every file dropped afterwards — and since a
  // document saved by 0.1.x carries the 0.1.x vocabulary, one such document in
  // the history was enough for the old keys to propagate forever.
  const newDocDefaults = useRef({ fields: draft, sampling: draftSampling });
  newDocDefaults.current = { fields: draft, sampling: draftSampling };
  const classifier = useRef<{ project: Project | undefined; docLang: DocLang; projectId: string }>({
    project: projects[0],
    docLang,
    projectId,
  });
  classifier.current = { project: projects.find((p) => p.id === projectId), docLang, projectId };
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
      setDocs((cur) => (cur === INITIAL ? d : merge(cur, d)));
      // Deliberately does not select one. A stored document carries the schema
      // it was run with, possibly from an older version of the app, and opening
      // on it presents that schema as though it were today's preset.
    });
    loadPrefs().then((p) => {
      setLang(p.lang);
      setProjects(p.projects);
      setProjectId(p.activeProjectId);
      const home = p.projects.find((x) => x.id === p.activeProjectId) ?? p.projects[0];
      setDraftLang(home.docLang);
      // The draft is still the untouched default preset, so it becomes the
      // stored folder's preset rather than staying a mix.
      if (home.docLang !== DEFAULT_PREFS.projects[0].docLang) {
        setDraft((cur) =>
          sameKeys(cur, defaultFields(DEFAULT_PREFS.projects[0].docLang))
            ? defaultFields(home.docLang)
            : cur,
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

  const prefs = { lang, projects, activeProjectId: projectId };

  function changeLanguage(next: Lang) {
    setLang(next);
    void savePrefs({ ...prefs, lang: next });
  }

  /**
   * The language of THIS extraction, which may differ from its folder's. Only
   * an untouched schema follows it: an edited one is work someone did.
   */
  function changeDocLang(next: DocLang) {
    if (sameKeys(fields, defaultFields(docLang))) setFields(defaultFields(next));
    if (doc) patch(doc.id, { docLang: next });
    // The draft language follows either way, because setFields writes the draft
    // either way: letting them disagree meant the next folder you opened saw a
    // draft whose keys were one language and whose language said another.
    setDraftLang(next);
  }

  /**
   * A folder's own settings. Its language decides what a new document in here
   * starts from, so changing it moves the class list and the draft schema with
   * it — but only while they are still the untouched defaults.
   */
  function changeProject(next: Project) {
    const was = projects.find((p) => p.id === next.id);
    const moved = was !== undefined && was.docLang !== next.docLang;
    const settled =
      moved && sameKeys(next.classes, defaultClasses(was.docLang))
        ? { ...next, classes: defaultClasses(next.docLang) }
        : next;
    const nextProjects = projects.map((p) => (p.id === settled.id ? settled : p));
    setProjects(nextProjects);
    void savePrefs({ ...prefs, projects: nextProjects });
    if (moved && settled.id === projectId) {
      if (sameKeys(draft, defaultFields(was.docLang))) setDraft(defaultFields(settled.docLang));
      setDraftLang(settled.docLang);
    }
  }

  function chooseProject(id: string) {
    const next = projects.find((p) => p.id === id);
    if (!next) return;
    setProjectId(id);
    setActiveId(null);
    // A folder you switch into brings its own language, and with it the schema
    // the next document starts from — as long as nobody has edited the draft.
    if (sameKeys(draft, defaultFields(draftLang))) setDraft(defaultFields(next.docLang));
    setDraftLang(next.docLang);
    void savePrefs({ ...prefs, activeProjectId: id });
  }

  function addProject(name: string) {
    // A new folder starts in the language of the one you were in: most people
    // making a second folder are still working in the same paperwork.
    const next = {
      id: crypto.randomUUID(),
      name,
      docLang: project.docLang,
      classify: true,
      classes: defaultClasses(project.docLang),
    };
    const nextProjects = [...projects, next];
    setProjects(nextProjects);
    setProjectId(next.id);
    setActiveId(null);
    void savePrefs({ ...prefs, projects: nextProjects, activeProjectId: next.id });
    setEditingProject(true);
  }

  /**
   * The folder goes; its documents do not. They move to the first project,
   * because a document you spent a model run on should not be deleted by a
   * decision about filing.
   */
  function removeProject(id: string) {
    if (projects.length < 2) return;
    const nextProjects = projects.filter((p) => p.id !== id);
    const home = nextProjects[0].id;
    setDocs((ds) => ds.map((d) => (projectOf(d) === id ? { ...d, projectId: home } : d)));
    setProjects(nextProjects);
    setProjectId(home);
    setActiveId(null);
    setEditingProject(false);
    void savePrefs({ ...prefs, projects: nextProjects, activeProjectId: home });
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
        projectId: classifier.current.projectId,
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
    const { project, docLang } = classifier.current;
    const classes = project?.classes ?? [];
    const lines = pages.flatMap((p) => p.lines.map((l) => l.text));
    if (!project?.classify || classes.length === 0 || lines.length === 0 || !inTauri) {
      patch(id, { pages, status: "ready" });
      return;
    }
    patch(id, { pages, status: "classifying" });
    try {
      const raw = await extract(buildPrompt("classify", classes, lines), CLASSIFY_SAMPLING, noop);
      const picked = parseClass(raw, classes, classAlias(docLang));
      // An answer nobody can place is worth saying out loud: a silently dropped
      // one is indistinguishable from classification being switched off, which
      // is exactly how a 100% failure rate went unnoticed.
      if (picked === null) console.warn("classification answered off the list:", raw.trim());
      patch(id, { status: "ready", docClass: picked ?? undefined });
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

  /**
   * An edit goes to two places, and they mean different things.
   *
   * `doc.fields` is the record of the prompt this document was run with, so the
   * saved result stays readable against the schema that produced it. The draft
   * is the schema you are building — the one the next document inherits. Writing
   * only the document made the draft dead state the moment anything was
   * selected; writing only the draft threw the edit away for the open document.
   */
  function setFields(next: Field[]) {
    setDraft(next);
    if (doc) patch(doc.id, { fields: next });
  }

  /**
   * The eye on one field. It lives on the schema, so the next document inherits
   * it — but only the flag goes to the draft. Handing the draft this document's
   * whole schema would make an old document's keys the template for new ones.
   */
  function toggleHidden(key: string) {
    const hidden = !fields.find((f) => f.key === key)?.hidden;
    const flip = (fs: Field[]) => fs.map((f) => (f.key === key ? { ...f, hidden } : f));
    setDraft(flip);
    if (doc) patch(doc.id, { fields: flip(doc.fields) });
  }

  function setSampling(next: Sampling) {
    setDraftSampling(next);
    if (doc) patch(doc.id, { sampling: next });
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
            <span className="beta" data-hint={t.betaTitle}>
              beta
            </span>
          </span>
          {doc && (
            <span className="topbar-doc" data-hint={doc.name}>
              {doc.name}
            </span>
          )}
          {/* The class travels with the document name, so it is on screen with
              the rail collapsed too. Nothing is drawn before an answer: an
              empty tag would read as a class the model chose. */}
          {doc?.docClass !== undefined && (
            <span className="tag class-tag" data-hint={t.classHelp}>
              <TagIcon size={12} weight="regular" />
              {doc.docClass}
            </span>
          )}
          <span className={`pill status-${status}`}>
            <i className={dotClass(status)} />
            {/* "Ready" next to a button saying the model cannot run is a lie, and
                the chip is the louder of the two. Say the thing that blocks. */}
            {statusText}
          </span>
          <span className="grow" />
          {reason !== "" && (
            <span className="reason" data-hint={reason}>
              {reason}
            </span>
          )}
          <button
            className="btn primary"
            disabled={reason !== ""}
            // Working and blocked were the same grey button. Tinted-not-filled
            // is already this app's word for "the accent action, not pressable
            // right now", so busy borrows it and blocked keeps the grey.
            data-busy={status === "extracting" || undefined}
            data-hint={reason === "" ? t.runExtraction : reason}
            onClick={runExtract}
          >
            <Play size={14} weight="fill" />
            {status === "extracting" ? t.extracting : t.extract}
          </button>
          <button
            ref={gearRef}
            className="btn"
            aria-expanded={settings}
            data-hint={t.settingsTitle}
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
              data-hint={t.close}
              onClick={() => setHushed(true)}
            >
              <X size={14} weight="regular" />
            </button>
          </div>
        )}

        <div className="workspace">
          <Sidebar
            docs={inProject}
            projects={projects}
            project={project}
            counts={counts}
            onProject={chooseProject}
            onNewProject={() => addProject(t.newProjectName)}
            onEditProject={() => setEditingProject(true)}
            onDeleteProject={removeProject}
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
              spans={located.spans}
              hiddenCount={hiding.length - located.missing.length}
              notFound={located.missing.length}
              unsettled={unsettled}
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
              onHide={toggleHidden}
              notFound={located.missing}
              onSettings={() => setSettings(true)}
            />
          </main>
        </div>

        {/* One bubble for the whole app. WKWebView draws no `title` tooltip, so
            every explanation in this UI was invisible in the shipped build. */}
        <Hints />

        {settings && (
          <SettingsPanel
            fields={fields}
            known={schemaFor(docLang)}
            onFields={setFields}
            sampling={sampling}
            onSampling={setSampling}
            lang={lang}
            onLang={changeLanguage}
            docLang={docLang}
            onDocLang={changeDocLang}
            onClose={closeSettings}
          />
        )}

        {editingProject && (
          <ProjectPanel
            project={project}
            trainedClasses={classesFor(project.docLang)}
            count={inProject.length}
            canDelete={projects.length > 1}
            onChange={changeProject}
            onDelete={() => removeProject(project.id)}
            onClose={() => setEditingProject(false)}
          />
        )}
      </div>
    </Words.Provider>
  );
}

/** Where a document lives. History written before projects existed is in the first. */
function projectOf(d: Doc): string {
  return d.projectId ?? FIRST_PROJECT;
}

/**
 * The stored history folded into what is already on screen, by id.
 *
 * This has to be idempotent, and it was not. StrictMode mounts the effect twice
 * in a development build, both loads resolve, and appending the history onto a
 * state that already held it doubled the list — then the debounced save wrote
 * the doubled list back, so every `npm run tauri dev` launch doubled it again:
 * one document became two, then four, then eight. What you saw was one file
 * listed eleven times.
 *
 * Returns `cur` unchanged when there is nothing new, so a second load is not
 * even a new array identity and cannot trigger a pointless megabyte write.
 */
function merge(cur: Doc[], stored: Doc[]): Doc[] {
  const seen = new Set(cur.map((d) => d.id));
  const add = stored.filter((d) => !seen.has(d.id));
  return add.length === 0 ? cur : [...cur, ...add];
}

/**
 * Two schemas naming the same keys in the same order: nobody has edited this
 * one. A closed eye is an edit too — swapping such a schema for a fresh preset
 * would quietly open it again.
 */
function sameKeys(a: Field[], b: Field[]): boolean {
  return a.length === b.length && a.every((f, i) => f.key === b[i].key && !f.hidden);
}
