/** npm test. Guards the model contract: if this fails, extraction quality is next. */
import { buildSystem, buildPrompt, parseAnswer, parseClass, isGrounded } from "./prompt";
import {
  DOC_LANGS,
  classAlias,
  classesFor,
  classesShown,
  eyeOf,
  presetFor,
  samePreset,
  withEyes,
  defaultClasses,
  defaultFields,
  schemaFor,
} from "./catalog";

/** No framework and no @types/node: one comparison is the whole harness. */
function eq(got: unknown, want: unknown, what = "") {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) throw new Error(`${what}\n  got  ${g}\n  want ${w}`);
}

const HEADER = "You are an expert document analysis model.\n";

// Captured from andreagemelli/xfund-docai-xl, val row it_val_0, first two keys.
const schema = schemaFor("it");
const fields = [
  { key: "cognome", description: schema["cognome"] },
  { key: "nome", description: schema["nome"] },
];
const GOLDEN =
  HEADER +
  "Task: information extraction\n" +
  "Return a JSON object with exactly the keys listed below, in the same order. " +
  "Every value must be copied verbatim from the document. Omit a key whose value " +
  "is absent.\n\nSchema:\n" +
  "cognome: il cognome della persona.\n" +
  "nome: il nome di battesimo della persona.\n";

eq(buildSystem("extract", fields), GOLDEN);

// The classification system message: same header, one line different, then the
// twelve classes in the order classes.json lists them.
const classes = defaultClasses("it");
const CLS_GOLDEN =
  HEADER +
  "Task: document classification\n" +
  "Assign the document to exactly one of the classes listed below. " +
  'Answer with a JSON object of the form {"class": "<class>"}.\n\nClasses:\n';
const cls = buildSystem("classify", classes);
eq(cls.startsWith(CLS_GOLDEN), true, "classification header");
eq(cls.slice(CLS_GOLDEN.length).split("\n").length - 1, 12, "twelve class lines");
eq(cls.includes("delega: "), true, "the localized class name, not the id");

// Every published key of every shipped language: header verbatim, one line each.
for (const lang of DOC_LANGS) {
  const all = Object.entries(schemaFor(lang)).map(([key, description]) => ({
    key,
    description,
  }));
  const full = buildSystem("extract", all);
  const head = GOLDEN.slice(0, GOLDEN.indexOf("cognome:"));
  eq(full.startsWith(head), true, `${lang} header`);
  eq(full.slice(head.length).split("\n").length - 1, all.length, `${lang} lines`);
  // A preset must carry the wording the fine-tune saw, so every default key is
  // in the published schema and its description is the published one.
  for (const f of defaultFields(lang)) eq(f.description, schemaFor(lang)[f.key], `${lang} ${f.key}`);
}

const lines = ["Comune di Arezzo", "☑ Sig.  Mario  Rossi", "nato a  Prato"];
eq(
  buildPrompt("extract", fields, lines),
  "<|startoftext|><|im_start|>system\n" +
    GOLDEN +
    "<|im_end|>\n<|im_start|>user\n" +
    "Comune di Arezzo\n☑ Sig.  Mario  Rossi\nnato a  Prato" +
    "<|im_end|>\n<|im_start|>assistant\n",
);

eq(parseAnswer('```json\n{"nome": "Mario"}\n```', fields), { nome: "Mario" });
eq(parseAnswer('{"nome": "Mario"} and that is all I found.', fields), { nome: "Mario" });
eq(parseAnswer('{"nome": "Mario", "citta": "Arezzo"}', fields), { nome: "Mario" });
eq(parseAnswer('{"nome": 52100}', fields), { nome: "52100" });
eq(parseAnswer('{"nome": "", "cognome": "Rossi"}', fields), { cognome: "Rossi" });
eq(parseAnswer("I could not find anything.", fields), null);
eq(parseAnswer('{"nome": oops}', fields), null);
// The pairs of an object the model never closed are still worth keeping.
eq(parseAnswer('{"cognome": "Rossi", "nome": "Mar', fields), { cognome: "Rossi" });

eq(parseClass('{"class": "delega"}', classes), "delega");
eq(parseClass('```json\n{"class": "Delega"}\n```', classes), "delega");
// A class it was never handed is the model paraphrasing, not an answer.
eq(parseClass('{"class": "modulo strano"}', classes), null);
eq(parseClass('{"cognome": "Rossi"}', classes), null);
eq(parseClass("dichiarazione", classes), null);
eq(parseClass('{"class": "ricevuta"}', classesToFields()), "ricevuta");

// The case that made classification look broken: the model names the class in
// the DOCUMENT's language whatever language the list it was handed is in, so an
// Italian page answered "dichiarazione" against the English list and every
// answer was thrown away. It resolves to the name the list actually uses.
const english = defaultClasses("en");
eq(parseClass('{"class": "dichiarazione"}', english), null, "no alias, no match");
eq(parseClass('{"class": "dichiarazione"}', english, classAlias("en")), "declaration");
eq(parseClass('{"class": "領収書"}', english, classAlias("en")), "receipt");
eq(parseClass('{"class": "Antrag"}', english, classAlias("en")), "application");
// Every language resolves to every other, or the table has a hole in it.
for (const from of DOC_LANGS) {
  for (const to of DOC_LANGS) {
    const said = defaultClasses(from)[7].key; // curriculum_vitae, an id whose names differ everywhere
    eq(parseClass(`{"class": "${said}"}`, defaultClasses(to), classAlias(to)), defaultClasses(to)[7].key, `${from}->${to}`);
  }
}
// An alias must never resurrect a class the caller deliberately removed.
eq(parseClass('{"class": "dichiarazione"}', english.filter((c) => c.key !== "declaration"), classAlias("en")), null);

// A page in another language than its folder: while the folder's list is the
// trained twelve the model is shown them in the page's language, and the answer
// is read against the folder's own list, so one folder groups by one set of tags.
{
  const folder = defaultClasses("en");
  const shown = classesShown(folder, "en", "it");
  eq(shown, defaultClasses("it"), "shown in the page's language");
  eq(parseClass('{"class": "dichiarazione"}', folder, classAlias("en")), "declaration", "filed under the folder's name");
  // An edited list — a new class, or a reworded description — cannot be translated.
  const added = [...folder.slice(0, 11), { key: "memo", description: "an internal note" }];
  eq(classesShown(added, "en", "it"), added, "an added class keeps the list");
  const reworded = folder.map((c, i) => (i === 0 ? { ...c, description: "any form, however short" } : c));
  eq(classesShown(reworded, "en", "it"), reworded, "a reworded description keeps the list");
  eq(classesShown(folder, "en", "en"), folder, "same language: nothing to swap");
}

// The eye across languages. It is remembered by what a key means, so closing
// `name`... on an English page closes the same thing in the Italian preset; one
// with nothing to land on comes along as its own row. A swap never opens one.
{
  eq(eyeOf("it", "cognome"), eyeOf("de", "nachname"), "the same concept in two languages");
  eq(eyeOf("it", "codice-fiscale"), "key:codice-fiscale", "a key only Italian has");
  const shut = { [eyeOf("it", "cognome")]: true, [eyeOf("it", "codice-fiscale")]: true };
  const it = withEyes(defaultFields("it"), "it", shut);
  eq(it.filter((f) => f.hidden).map((f) => f.key), ["cognome", "codice-fiscale"]);
  // German asks for the full `name`, which holds the surname: it closes, and
  // covers the surname. The tax code has no German key, so it comes along as
  // its own row, still closed.
  const de = presetFor("de", it, "it", shut);
  eq(de.filter((f) => f.hidden).map((f) => f.key), ["name", "codice-fiscale"], "no eye is lost");
  // A full name hidden in English lands on both halves of the Italian preset,
  // and does not come along as a row of its own.
  const en = withEyes(defaultFields("en"), "en", { [eyeOf("en", "name")]: true });
  const fromEn = presetFor("it", en, "en", { [eyeOf("en", "name")]: true });
  eq(fromEn.filter((f) => f.hidden).map((f) => f.key), ["nome", "cognome"]);
  // An eye opened on purpose stays open, even on a part of a hidden whole.
  const open = { [eyeOf("en", "name")]: true, [eyeOf("it", "nome")]: false };
  eq(withEyes(defaultFields("it"), "it", open).filter((f) => f.hidden).map((f) => f.key), ["cognome"]);
  eq(samePreset(it, defaultFields("it")), true, "an eye is not an edit");
  eq(samePreset([{ ...it[0], description: "x" }, ...it.slice(1)], defaultFields("it")), false, "a description is");
}

/** The class list as the settings panel keeps it: same shape, order preserved. */
function classesToFields() {
  return Object.entries(classesFor("it")).map(([key, description]) => ({ key, description }));
}

eq(isGrounded("Mario Rossi", lines), true);
eq(isGrounded("Marco Rossi", lines), false);

console.log("ok");
