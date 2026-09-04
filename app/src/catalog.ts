/**
 * What the model was trained on, per language: the key vocabulary it can fill
 * and the twelve classes it can pick from.
 *
 * Both files are lifted verbatim from andreagemelli/xfund-docai-xl, so a preset
 * carries the exact wording the fine-tune saw. Editing a description here, or in
 * the UI, is editing the prompt.
 */
import classes from "./classes.json";
import schemas from "./schemas.json";
import type { Field, Lang } from "./types";

const SCHEMAS: Record<Lang, Record<string, string>> = schemas;
const CLASSES: Record<string, Record<Lang, { name: string; description: string }>> = classes;

/**
 * The keys a new document starts with. The model was fine-tuned on prompts
 * averaging seven fields, so seven, not all thirty nine. More keys, less
 * precision.
 */
const DEFAULT_KEYS: Record<Lang, string[]> = {
  en: ["name", "date-of-birth", "place-of-birth", "address", "city", "telephone", "email"],
  it: ["nome", "cognome", "data-nascita", "luogo-nascita", "codice-fiscale", "indirizzo", "comune"],
};

/** Every key the fine-tune saw in this language, key → description. */
export function schemaFor(lang: Lang): Record<string, string> {
  return SCHEMAS[lang];
}

export function defaultFields(lang: Lang): Field[] {
  return DEFAULT_KEYS[lang].map((key) => ({ key, description: SCHEMAS[lang][key] }));
}

/**
 * The twelve classes, in the order the dataset lists them. Class ids are
 * English and never reach the model; the localized name is what it answers
 * with, so that name is the key here.
 */
export function defaultClasses(lang: Lang): Field[] {
  return Object.values(CLASSES).map((c) => ({
    key: c[lang].name,
    description: c[lang].description,
  }));
}

/** Class name → description, for telling a trained class from an invented one. */
export function classesFor(lang: Lang): Record<string, string> {
  return Object.fromEntries(defaultClasses(lang).map((c) => [c.key, c.description]));
}
