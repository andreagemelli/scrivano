import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowsClockwise,
  Gear,
  Play,
  Tag as TagIcon,
  Translate,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { backendStatus, detectLang, extract, inTauri } from "./api";
import { loadPages } from "./pdf";
import { DEFAULT_PREFS, FIRST_PROJECT, loadDocs, loadPrefs, saveDocs, savePrefs } from "./store";
import { buildPrompt, parseAnswer, parseClass } from "./prompt";
import { hiddenValues, locate } from "./redact";
import {
  DOC_LANGS,
  classAlias,
  classesFor,
  classesShown,
  defaultClasses,
  defaultFields,
  eyeOf,
  presetFor,
  samePreset,
  schemaFor,
  withEyes,
} from "./catalog";
import { DOC_LANGUAGE_NAME } from "./LangPicker";
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

/** Empty string means "classify again" can run on this document. */
function classifyBlocker(
  t: Dict,
  doc: Doc | null,
  project: Project,
  backend: { ok: boolean; detail: string } | null,
): string {
  if (!doc) return t.needDocument;
  if (doc.status === "reading") return t.stillReading;
  if (doc.status === "classifying") return t.stillClassifying;
  if (doc.status === "extracting") return t.alreadyExtracting;
  if (doc.pages.every((p) => p.lines.length === 0)) return t.noText;
  if (project.classes.length === 0) return t.noClasses;
  if (!inTauri) return t.noDevServer;
  if (backend && !backend.ok) return t.noModel;
  return "";
}

/** Empty string means a whole folder can be classified again. */
function sweepBlocker(
  t: Dict,
  docs: Doc[],
  project: Project,
  backend: { ok: boolean; detail: string } | null,
  running: boolean,
): string {
  if (running) return t.sweepRunning;
  if (docs.length === 0) return t.noDocumentsHere;
  if (project.classes.length === 0) return t.noClasses;
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
  // The eye, remembered for the session by what the key means (`eyeOf`), not
  // by the key: a schema is swapped for another language's preset often — on
  // detection, on a folder or language change — and the eye has to survive the
  // swap, or a batch quietly stops being hidden halfway through.
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const shutRef = useRef(shut);
  shutRef.current = shut;
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState("");
  const [hushed, setHushed] = useState(false);
  const [railOpen, setRailOpen] = useState(railFromSession);
  const [settings, setSettings] = useState(false);
  // The text the JSON pane is pointing at, or null. Read by the document pane.
  const [highlight, setHighlight] = useState<string | null>(null);
  const disk = useRef<Doc[]>(INITIAL);
  // The documents as last rendered, for an async step that must see edits made
  // while it waited — a schema changed while its file was still being read.
  const docsNow = useRef<Doc[]>(INITIAL);
  docsNow.current = docs;
  // Same reason: a sweep over a folder must classify with the list as it is
  // when it reaches each document, not as it was when the sweep began.
  const projectsNow = useRef(projects);
  projectsNow.current = projects;
  // A folder being classified again, one document after another, and how far along.
  const [sweep, setSweep] = useState<{ projectId: string; done: number; of: number } | null>(null);
  // Documents owed a new class, asked for while they were busy with a run of
  // their own: they are asked again the moment they are free.
  const owed = useRef(new Set<string>());
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
  const newDocDefaults = useRef({ fields: draft, lang: draftLang, sampling: draftSampling });
  newDocDefaults.current = { fields: draft, lang: draftLang, sampling: draftSampling };
  const opening = useRef<{ project: Project; projectId: string }>({ project, projectId });
  opening.current = { project, projectId: project.id };
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
          samePreset(cur, defaultFields(DEFAULT_PREFS.projects[0].docLang))
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
    if (samePreset(fields, defaultFields(docLang))) setFields(presetFor(next, fields, docLang, shut));
    if (doc) {
      patch(doc.id, { docLang: next });
      // Its class was chosen from a list in the language it was thought to be
      // in; a corrected language is a reason to ask again — when the model
      // would be shown something different, which an edited list never is.
      const shown = (l: DocLang) => classesShown(project.classes, project.docLang, l);
      const differs = !samePreset(shown(next), shown(docLang));
      if (differs && (doc.docClass !== undefined || project.classify)) void reclassify(doc.id, next);
    }
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
      moved && samePreset(next.classes, defaultClasses(was.docLang))
        ? { ...next, classes: defaultClasses(next.docLang) }
        : next;
    const nextProjects = projects.map((p) => (p.id === settled.id ? settled : p));
    setProjects(nextProjects);
    void savePrefs({ ...prefs, projects: nextProjects });
    if (moved && settled.id === projectId) {
      if (samePreset(draft, defaultFields(was.docLang))) setDraft(presetFor(settled.docLang, draft, was.docLang, shut));
      setDraftLang(settled.docLang);
    }
  }

  function chooseProject(id: string) {
    const next = projects.find((p) => p.id === id);
    // The folder you are in: nothing to switch, and nothing to deselect —
    // its gear goes through here, and it used to close the open document.
    if (!next || id === projectId) return;
    setProjectId(id);
    setActiveId(null);
    // A folder you switch into brings its own language, and with it the schema
    // the next document starts from — as long as nobody has edited the draft.
    if (samePreset(draft, defaultFields(draftLang))) setDraft(presetFor(next.docLang, draft, draftLang, shut));
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
      detectLang: true,
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
    // The folder it opens into, fixed now: switching folders while it reads
    // must not change which folder's rules it is classified by.
    const { project: home } = opening.current;
    const draft = newDocDefaults.current;
    setDocs((ds) => [
      {
        id,
        name: path.split(/[\\/]/).pop() ?? path,
        addedAt: Date.now(),
        pages: [],
        fields: withEyes(draft.fields, draft.lang, shutRef.current),
        sampling: draft.sampling,
        projectId: home.id,
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
    // The page says what language it is in, and that decides the language of
    // everything the model is shown for it. Read against the document as it is
    // now, not as it was when the file was dropped: a language or a schema set
    // by hand while it was reading wins over the page.
    // The OCR recognises Latin script only. A Chinese or Japanese scan comes out
    // as its emails, codes and company names, which read as French or English:
    // evidence of nothing, so in such a folder an OCR'd page does not overrule it.
    const blind = (home.docLang === "zh" || home.docLang === "ja") && pages.some((p) => !p.fromTextLayer);
    const detected = home.detectLang && !blind ? await detectPage(pages) : undefined;
    const now = docsNow.current.find((d) => d.id === id);
    if (!now) return; // deleted while it was reading
    const lang = now.docLang ?? detected?.lang ?? draft.lang;
    // An untouched preset follows; an edited schema is somebody's work.
    const swap = lang !== draft.lang && samePreset(now.fields, defaultFields(draft.lang));
    patch(id, {
      pages,
      detected,
      // Recorded when it is not simply the folder's, so the tag can say why.
      ...(lang !== home.docLang || detected ? { docLang: lang } : {}),
      ...(swap && { fields: presetFor(lang, now.fields, draft.lang, shutRef.current) }),
    });
    await classifyDoc(id, pages, home, lang);
  }

  /** What language the pages are in, or null when the folder's should stand. */
  async function detectPage(pages: Page[]): Promise<Doc["detected"]> {
    if (!inTauri) return null;
    try {
      const got = await detectLang(pages.flatMap((p) => p.lines.map((l) => l.text)).join("\n"));
      return got && (DOC_LANGS as string[]).includes(got[0]) ? { lang: got[0] as DocLang, p: got[1] } : null;
    } catch (e) {
      // Detection is a convenience: without it the folder's language stands.
      console.error("language detection failed", e);
      return null;
    }
  }

  /**
   * Ask the model what kind of document this is: on open when the folder
   * classifies, and again by hand (`asked`) — from the top bar, the folder's
   * sweep, or a corrected language. A failure here is not the document's
   * failure: it still opens and extracts, and any class it had stays.
   */
  async function classifyDoc(id: string, pages: Page[], project: Project, docLang: DocLang, asked = false) {
    const lines = pages.flatMap((p) => p.lines.map((l) => l.text));
    // "Classify on open" governs opening; asking by hand is its own decision.
    if ((!project.classify && !asked) || project.classes.length === 0 || lines.length === 0 || !inTauri) {
      if (!asked) patch(id, { status: "ready" });
      return;
    }
    // Back to what it was once the class is in: a document classified again
    // after its extraction is still done, not merely ready.
    const was = docsNow.current.find((d) => d.id === id)?.status;
    const after: Status = was === "done" || was === "failed" ? was : "ready";
    patch(id, { status: "classifying" });
    try {
      const shown = classesShown(project.classes, project.docLang, docLang);
      const raw = await extract(buildPrompt("classify", shown, lines), CLASSIFY_SAMPLING, noop);
      // Read against the folder's own list: the alias table files a class named
      // in the page's language under the folder's name for it.
      const picked = parseClass(raw, project.classes, classAlias(project.docLang));
      // An answer nobody can place is worth saying out loud: a silently dropped
      // one is indistinguishable from classification being switched off, which
      // is exactly how a 100% failure rate went unnoticed.
      if (picked === null) console.warn("classification answered off the list:", raw.trim());
      patch(id, { status: after, docClass: picked ?? undefined });
    } catch (e) {
      // The class it had stays: a failed run is not an answer.
      console.error("classification failed", e);
      patch(id, { status: after });
    }
  }

  /**
   * Ask again, by hand: after the folder's class list changed, or the page's
   * language did. With the folder's list as it is now, in `lang` if given.
   */
  async function reclassify(id: string, lang?: DocLang) {
    const d = docsNow.current.find((x) => x.id === id);
    if (!d) return;
    if (d.status === "reading" || d.status === "classifying" || d.status === "extracting") {
      // Busy with a run of its own: its turn comes when that ends, not never.
      owed.current.add(id);
      return;
    }
    const home = projectsNow.current.find((p) => p.id === projectOf(d)) ?? projectsNow.current[0];
    await classifyDoc(id, d.pages, home, lang ?? d.docLang ?? home.docLang, true);
  }

  // Pays what `reclassify` could not: every owed document that is free now,
  // in the language it has now, which is whatever it was last corrected to.
  useEffect(() => {
    for (const id of owed.current) {
      const d = docs.find((x) => x.id === id);
      if (d && (d.status === "reading" || d.status === "classifying" || d.status === "extracting")) continue;
      owed.current.delete(id);
      if (d) void reclassify(id);
    }
  }, [docs]);

  /**
   * Every document in a folder, one after another. The model runs one thing at
   * a time anyway, and a queue that says how far it has got is easier to trust
   * than a dozen spinners.
   */
  async function reclassifyAll(projectId: string) {
    const ids = docsNow.current.filter((d) => projectOf(d) === projectId).map((d) => d.id);
    try {
      for (const [i, id] of ids.entries()) {
        setSweep({ projectId, done: i, of: ids.length });
        await reclassify(id);
      }
    } finally {
      setSweep(null);
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
    if (doc) {
      patch(doc.id, { fields: next });
      // The draft now holds this document's keys, so it is in this document's
      // language: letting the two disagree made the next page skip its swap.
      setDraftLang(docLang);
    }
    // An eye opened or closed in the schema drawer is remembered like one
    // toggled on a result.
    const eyes = next.filter((f) => {
      const was = fields.find((o) => o.key === f.key);
      return was !== undefined && !was.hidden !== !f.hidden;
    });
    if (eyes.length > 0) {
      setShut((m) => ({ ...m, ...Object.fromEntries(eyes.map((f) => [eyeOf(docLang, f.key), !!f.hidden])) }));
    }
  }

  /**
   * The eye on one field. It lives on the schema, so the next document inherits
   * it — but only the flag goes to the draft. Handing the draft this document's
   * whole schema would make an old document's keys the template for new ones.
   */
  function toggleHidden(key: string) {
    const hidden = !fields.find((f) => f.key === key)?.hidden;
    const eye = eyeOf(docLang, key);
    setShut((m) => ({ ...m, [eye]: hidden }));
    // By meaning, so it lands on the draft's key for the same thing even when
    // the draft is in another language.
    setDraft((d) => withEyes(d, draftLang, { [eye]: hidden }));
    if (doc) patch(doc.id, { fields: withEyes(doc.fields, docLang, { [eye]: hidden }) });
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
    // not running at. One channel message is one token, so counting them is exact.
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
  const classifyWhy = classifyBlocker(t, doc, project, backend);
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
          {/* Asking again sits on the tag it would change. With no class yet it
              is the tag's own place, dashed, so the empty state reads as "not
              asked" rather than as a class called nothing. */}
          {doc && doc.pages.length > 0 &&
            (doc.docClass === undefined ? (
              <button
                className="tag tag-btn"
                aria-disabled={classifyWhy !== "" || undefined}
                aria-description={classifyWhy || undefined}
                data-hint={classifyWhy || t.classifyNowHelp}
                onClick={() => classifyWhy === "" && void reclassify(doc.id)}
              >
                <TagIcon size={12} weight="regular" />
                {doc.status === "classifying" ? t.statusLabel.classifying : t.classifyNow}
              </button>
            ) : (
              <button
                className="icon-btn tag-act"
                aria-label={classifyWhy || t.classifyAgain}
                aria-disabled={classifyWhy !== "" || undefined}
                data-hint={classifyWhy || t.classifyAgainHelp}
                onClick={() => classifyWhy === "" && void reclassify(doc.id)}
              >
                <ArrowsClockwise size={14} weight="regular" />
              </button>
            ))}
          {/* The language everything the model sees is written in, and where
              that came from: the page itself, a choice, or the folder. */}
          {doc && doc.pages.length > 0 && (
            <span className="tag" data-hint={langHint(t, doc, docLang)}>
              <Translate size={12} weight="regular" />
              {docLang.toUpperCase()}
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
            sweep={sweep?.projectId === project.id ? sweep : null}
            sweepBlocked={sweepBlocker(t, inProject, project, backend, sweep !== null)}
            onReclassifyAll={() => void reclassifyAll(project.id)}
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

/** Where the document's language came from, in words. */
function langHint(t: Dict, doc: Doc, lang: DocLang): string {
  const name = DOC_LANGUAGE_NAME[lang];
  if (doc.docLang && doc.detected?.lang === doc.docLang) {
    return t.langDetected(name, Math.round(doc.detected.p * 100));
  }
  if (doc.docLang) return t.langChosen(name);
  return doc.detected === null ? t.langUnsure(name) : t.langFolder(name);
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
