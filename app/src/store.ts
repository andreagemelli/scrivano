import { load } from "@tauri-apps/plugin-store";
import { defaultClasses } from "./catalog";
import type { Doc, DocLang, Field, Lang, Line, Project } from "./types";

const MAX = 50;

/** What the app remembers between launches, beyond the documents themselves. */
export type Prefs = {
  /** The language the interface is written in. */
  lang: Lang;
  /** Folders of documents. There is always at least one. */
  projects: Project[];
  /** Which folder new documents are opened into. */
  activeProjectId: string;
};

/** The folder that always exists, so there is never a "no project" state. */
export const FIRST_PROJECT = "inbox";

export const DEFAULT_PREFS: Prefs = {
  lang: "en",
  projects: [
    { id: FIRST_PROJECT, name: "", docLang: "en", classify: true, classes: defaultClasses("en") },
  ],
  activeProjectId: FIRST_PROJECT,
};

async function store() {
  return load("history.json", { autoSave: false });
}

/**
 * Preferences live apart from the history on purpose. The history is megabytes
 * of base64 page images and resolves long after the first paint; a preference is
 * a hundred bytes and is needed before the first document is opened. Sharing one
 * file meant a document dropped early was classified against whatever the
 * defaults happened to be.
 */
async function prefStore() {
  return load("prefs.json", { autoSave: false });
}

/**
 * Before boxes existed a line was a bare string. Old history stays openable:
 * a string becomes { text }, with no box, so it highlights in the text view
 * and simply is not drawn on the page view.
 */
function normalise(docs: Doc[]): Doc[] {
  for (const d of docs) {
    for (const p of d.pages ?? []) {
      p.lines = (p.lines ?? []).map((l: Line | string) =>
        typeof l === "string" ? { text: l } : l,
      );
    }
  }
  return docs;
}

/** A corrupt or unreadable store must not brick the app, so failure is an empty history. */
export async function loadDocs(): Promise<Doc[]> {
  try {
    const docs = await (await store()).get<Doc[]>("docs");
    return Array.isArray(docs) ? normalise(docs) : [];
  } catch {
    return [];
  }
}

export async function saveDocs(docs: Doc[]): Promise<void> {
  const s = await store();
  await s.set("docs", docs.slice(0, MAX));
  await s.save();
}

/** Same rule as the history: an unreadable store falls back to the defaults. */
export async function loadPrefs(): Promise<Prefs> {
  try {
    // 0.2.0-beta kept preferences inside history.json. Read the old place when
    // the new one is empty, so an upgrade does not silently reset the language.
    const p =
      (await (await prefStore()).get<Partial<Prefs>>("prefs")) ??
      (await (await store()).get<Partial<Prefs>>("prefs"));
    const prefs = { ...DEFAULT_PREFS, ...p };
    // 0.2.0-beta had one global language, one classify flag and one class list.
    // They become the first project's, so nothing anyone edited is lost.
    const old = p as
      | (Partial<Prefs> & { classify?: boolean; classes?: Field[]; docLang?: DocLang })
      | null;
    const wasLang: DocLang = old?.docLang ?? "en";
    if (!Array.isArray(prefs.projects) || prefs.projects.length === 0) {
      prefs.projects = [
        {
          id: FIRST_PROJECT,
          name: "",
          docLang: wasLang,
          classify: old?.classify ?? true,
          classes:
            Array.isArray(old?.classes) && old.classes.length > 0
              ? old.classes
              : defaultClasses(wasLang),
        },
      ];
    }
    // A store hand-edited into nonsense must not leave the app unusable.
    for (const project of prefs.projects) {
      if (!project.docLang) project.docLang = wasLang;
      if (!Array.isArray(project.classes)) project.classes = defaultClasses(project.docLang);
    }
    if (!prefs.projects.some((x) => x.id === prefs.activeProjectId)) {
      prefs.activeProjectId = prefs.projects[0].id;
    }
    return prefs;
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  const s = await prefStore();
  await s.set("prefs", prefs);
  await s.save();
}
