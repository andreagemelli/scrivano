import { load } from "@tauri-apps/plugin-store";
import { defaultClasses } from "./catalog";
import type { Doc, Field, Lang, Line } from "./types";

const MAX = 50;

/** What the app remembers between launches, beyond the documents themselves. */
export type Prefs = {
  lang: Lang;
  /** Ask the model for a class as soon as a document is opened. */
  classify: boolean;
  /** The classes it may pick from. Editable, so it is stored, not derived. */
  classes: Field[];
};

export const DEFAULT_PREFS: Prefs = {
  lang: "en",
  classify: true,
  classes: defaultClasses("en"),
};

async function store() {
  return load("history.json", { autoSave: false });
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
    const p = await (await store()).get<Partial<Prefs>>("prefs");
    const prefs = { ...DEFAULT_PREFS, ...p };
    // A store written before classes existed, or one someone hand-edited into
    // nonsense, must not leave the class list unusable.
    if (!Array.isArray(prefs.classes)) prefs.classes = defaultClasses(prefs.lang);
    return prefs;
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  const s = await store();
  await s.set("prefs", prefs);
  await s.save();
}
