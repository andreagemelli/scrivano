import { load } from "@tauri-apps/plugin-store";
import type { Doc, Line } from "./types";

const MAX = 50;

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
