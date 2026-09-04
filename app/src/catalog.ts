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
import schemas from "./schemas.json";
import type { DocLang, Field } from "./types";

const SCHEMAS: Record<DocLang, Record<string, string>> = schemas;
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
