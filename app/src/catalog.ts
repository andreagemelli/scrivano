/**
 * What the model was trained on, per language: the key vocabulary it can fill
 * and the twelve classes it can pick from.
 *
 * Both files are lifted verbatim from andreagemelli/xfund-docai-xl, so a preset
 * carries the exact wording the fine-tune saw. Editing a description here, or in
 * the UI, is editing the prompt.
 *
 * All eight trained languages ship, not just the two the interface speaks. The
 * language of the prompt belongs to the DOCUMENT, not to the reader: handing the
 * model an English schema for an Italian page measurably degrades it (it invents
 * an email address that is not on the page and answers the class in Italian
 * anyway), so someone reading English must still be able to say "these documents
 * are in Italian".
 */
import classes from "./classes.json";
import concepts from "./concepts.json";
import schemas from "./schemas.json";
import type { DocLang, Field } from "./types";

const SCHEMAS: Record<DocLang, Record<string, string>> = schemas;
/** Per language, key → the concept it names across languages, or null for a key only one has. */
const CONCEPTS: Record<DocLang, Record<string, string | null>> = concepts;
const CLASSES: Record<string, Record<DocLang, { name: string; description: string }>> = classes;

/**
 * The keys a new document starts with. Seven, because the fine-tune saw prompts
 * averaging about that many and more keys means less precision — and each set is
 * drawn from the keys that language's own training rows carry most often, not
 * translated from the Italian one. The English list is the exception worth
 * naming: its corpus is FUNSD business paperwork, whose commonest keys are `to`,
 * `from` and `project-number`, so it keeps the personal-and-contact spine every
 * other language has and takes `date`, which is the single most frequent key in
 * both English and Italian.
 */
const DEFAULT_KEYS: Record<DocLang, string[]> = {
  en: ["date", "name", "company", "address", "city", "telephone", "email"],
  it: ["nome", "cognome", "data-nascita", "luogo-nascita", "codice-fiscale", "indirizzo", "comune"],
  de: ["name", "vorname", "geburtsdatum", "adresse", "ort", "telefon", "e-mail"],
  es: ["nombre", "apellido", "fecha-nacimiento", "direccion", "ciudad", "telefono", "correo-electronico"],
  fr: ["nom", "prenom", "date-de-naissance", "adresse", "ville", "telephone", "email"],
  pt: ["nome", "data-nascimento", "endereco", "cidade", "telefone", "e-mail", "cpf"],
  zh: ["姓名", "出生日期", "性别", "地址", "联系电话", "身份证号", "日期"],
  ja: ["氏名", "生年月日", "住所", "電話番号", "メールアドレス", "記入日", "FAX"],
};

/** The languages the model was fine-tuned on, in the dataset's own order. */
export const DOC_LANGS = Object.keys(SCHEMAS) as DocLang[];

/** Every key the fine-tune saw in this language, key → description. */
export function schemaFor(lang: DocLang): Record<string, string> {
  return SCHEMAS[lang];
}

export function defaultFields(lang: DocLang): Field[] {
  return DEFAULT_KEYS[lang].map((key) => ({ key, description: SCHEMAS[lang][key] }));
}

/**
 * The twelve classes, in the order the dataset lists them. Class ids are
 * English and never reach the model; the localized name is what it answers
 * with, so that name is the key here.
 */
export function defaultClasses(lang: DocLang): Field[] {
  return Object.values(CLASSES).map((c) => ({
    key: c[lang].name,
    description: c[lang].description,
  }));
}

/** Class name → description, for telling a trained class from an invented one. */
export function classesFor(lang: DocLang): Record<string, string> {
  return Object.fromEntries(defaultClasses(lang).map((c) => [c.key, c.description]));
}

/**
 * Every trained class name in every language, mapped to the name in `lang`.
 *
 * The model answers with the class name in the DOCUMENT's language, whatever
 * language the list it was handed is in. Point it at an Italian page with an
 * English list and it says "dichiarazione" — a real class, correctly identified,
 * that a strict match against the English list throws away. This table is what
 * turns that back into "declaration" instead of losing the answer.
 */
export function classAlias(lang: DocLang): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of Object.values(CLASSES)) {
    for (const l of DOC_LANGS) out[c[l].name.toLowerCase()] = c[lang].name;
  }
  return out;
}

/**
 * The class list a page in `docLang` is shown.
 *
 * A folder's classes are written in the folder's language, but the model has to
 * see them in the page's: an Italian list over a German page is the same shift
 * as an Italian schema over it. While the folder's list is still the trained
 * twelve it is swapped for the same twelve in the page's language. An edited
 * list is somebody's work and cannot be translated, so it goes as it is. The
 * answer is read against the folder's own list either way: `classAlias` already
 * files a class named in any language under the folder's name for it.
 */
export function classesShown(folder: Field[], folderLang: DocLang, docLang: DocLang): Field[] {
  return folderLang !== docLang && samePreset(folder, defaultClasses(folderLang))
    ? defaultClasses(docLang)
    : folder;
}

/**
 * Two lists naming the same entries in the same order, with the same wording:
 * nobody has edited this one, so it may be swapped for another language's.
 * The eye is not wording — `withEyes` carries it across a swap.
 */
export function samePreset(a: Field[], b: Field[]): boolean {
  return a.length === b.length && a.every((f, i) => f.key === b[i].key && f.description === b[i].description);
}

/**
 * What an eye is remembered by. The same field has a different key in every
 * language — `cognome`, `nachname`, `surname` — and the dataset maps them onto
 * one concept, so an eye closed on one is closed on all of them. A key only one
 * language has, like `codice-fiscale`, is remembered by itself.
 */
export function eyeOf(lang: DocLang, key: string): string {
  const concept = CONCEPTS[lang]?.[key];
  return concept ? `concept:${concept}` : `key:${key}`;
}

/**
 * A full name holds a first name and a surname. Presets split names differently
 * — Italian asks for `nome` and `cognome`, German for `name` and `vorname`,
 * English for `name` alone — so hiding one part and showing the whole would
 * show the part. An eye closed on either side closes the other, unless that one
 * was opened on purpose.
 */
const PARTS: Record<string, string[]> = {
  "concept:full_name": ["concept:first_name", "concept:surname"],
  "concept:first_name": ["concept:full_name"],
  "concept:surname": ["concept:full_name"],
};

/** Closed only because a part or the whole of the same name was. */
function implied(eye: string, shut: Record<string, boolean>): boolean {
  return !(eye in shut) && Object.entries(PARTS).some(([from, to]) => shut[from] && to.includes(eye));
}

/** Whether the eye on `eye` is closed, open, or undecided. */
function closed(eye: string, shut: Record<string, boolean>): boolean | undefined {
  if (eye in shut) return shut[eye];
  return implied(eye, shut) || undefined;
}

/** A schema in `lang` with the remembered eyes applied: closed where closed anywhere, open where opened. */
export function withEyes(fields: Field[], lang: DocLang, shut: Record<string, boolean>): Field[] {
  return fields.map((f) => {
    const hidden = closed(eyeOf(lang, f.key), shut);
    if (hidden === undefined) return f;
    const { hidden: _, ...rest } = f;
    return hidden ? { ...rest, hidden: true } : rest;
  });
}

/**
 * `to`'s preset, taking the place of an untouched schema in `fromLang`.
 *
 * A swap must never open an eye. Eyes land on the same concept in the new
 * preset; one with nothing to land on — a `codice-fiscale` swapped for German —
 * comes along as its own row, still closed, rather than being dropped. An
 * untrained key in the prompt costs a little; a name in clear costs the point.
 */
export function presetFor(
  to: DocLang,
  from: Field[],
  fromLang: DocLang,
  shut: Record<string, boolean>,
): Field[] {
  const preset = withEyes(defaultFields(to), to, shut);
  const covered = new Set(preset.filter((f) => f.hidden).map((f) => eyeOf(to, f.key)));
  // Landed on itself, or on all of its parts: a hidden first name and surname
  // already black out the full name they make up.
  const lands = (eye: string) => covered.has(eye) || (PARTS[eye]?.every((p) => covered.has(p)) ?? false);
  // Only an eye someone closed travels as its own row. One closed by the name
  // rule follows the rule wherever it lands instead: hiding a surname hid the
  // English full name, but an Italian preset has its own surname to close.
  const stranded = from.filter((f) => {
    const eye = eyeOf(fromLang, f.key);
    return f.hidden && !lands(eye) && !implied(eye, shut);
  });
  return [...preset, ...stranded];
}
