/**
 * The model contract. Mirrors local/make_docai.py byte for byte.
 *
 * Both tasks open with the same header and diverge on one line, exactly as in
 * the published dataset andreagemelli/xfund-docai-xl. Verified against val row
 * it_val_0: the system message is the header, the task line, the instructions
 * and one "key: description.\n" per schema entry; the user message is the page
 * lines joined with "\n".
 *
 * If extraction or classification quality is wrong, look here first. This is the
 * only place a prompt is built.
 */
import type { Field, Task } from "./types";

/** make_docai.py SYSTEM_HEADER. No trailing newline: the task line adds it. */
const HEADER = "You are an expert document analysis model.";

/** make_docai.py KIE_INSTRUCTIONS. Ends with "Schema:\n". Do not reflow. */
const KIE =
  "Return a JSON object with exactly the keys listed below, in the same order. " +
  "Every value must be copied verbatim from the document. Omit a key whose value " +
  "is absent.\n\nSchema:\n";

/** make_docai.py CLS_INSTRUCTIONS. Ends with "Classes:\n". Do not reflow. */
const CLS =
  'Assign the document to exactly one of the classes listed below. ' +
  'Answer with a JSON object of the form {"class": "<class>"}.\n\nClasses:\n';

/** The literal the model was trained to see after "Task: ". */
const TASK_LINE: Record<Task, string> = {
  extract: "information extraction",
  classify: "document classification",
};

/**
 * System message content for either task.
 *
 * Both listings are one "name: description.\n" per entry, with no separator and
 * exactly one appended ".", since neither schemas.json nor classes.json carries
 * a terminal period. Keys, descriptions and class names must be in the
 * document's own language: that is how the model was trained, and mixing
 * languages inside one prompt is a distribution shift.
 *
 * The training set shuffled the class listing per example so position could not
 * predict the answer. At inference there is nothing to defend against and a
 * fixed order keeps a greedy run reproducible, so the caller's order stands.
 */
export function buildSystem(task: Task, entries: Field[]): string {
  return (
    `${HEADER}\nTask: ${TASK_LINE[task]}\n` +
    (task === "extract" ? KIE : CLS) +
    entries.map((f) => `${f.key}: ${f.description}.\n`).join("")
  );
}

/**
 * Fully rendered prompt, byte-identical to
 * tokenizer.apply_chat_template([system, user], add_generation_prompt=True).
 *
 * The chat template is plain ChatML with a <|startoftext|> BOS, so we render it
 * here rather than asking llama.cpp to run the jinja. Call llama.cpp with
 * add_bos = false, since the BOS is already in this string.
 *
 * `lines` is one entry per detected text region IN DETECTION ORDER. Do not sort
 * spatially, dedupe, collapse whitespace, or strip checkbox glyphs. The model
 * was trained on raw XFUND entity order, so "fixing" the reading order is a
 * distribution shift, not an improvement.
 */
export function buildPrompt(task: Task, entries: Field[], lines: string[]): string {
  return (
    "<|startoftext|>" +
    "<|im_start|>system\n" +
    buildSystem(task, entries) +
    "<|im_end|>\n" +
    "<|im_start|>user\n" +
    lines.join("\n") +
    "<|im_end|>\n" +
    "<|im_start|>assistant\n"
  );
}

/**
 * A 350M model does not always emit clean JSON. Strip code fences, take the
 * first balanced object, drop keys nobody asked for, and coerce non-strings.
 * Returns null when there is no usable object, so the caller can show the raw
 * output instead of pretending it got a result.
 */
export function parseAnswer(
  raw: string,
  fields: Field[],
): Record<string, string> | null {
  const wanted = new Set(fields.map((f) => f.key));
  const keep = (out: Record<string, string>, k: string, v: unknown) => {
    if (!wanted.has(k)) return; // the model invents keys now and then
    if (v === null || v === undefined || v === "") return; // "Omit a key whose value is absent"
    if (k in out) return; // a repetition loop repeats keys; the first answer is the considered one
    out[k] = typeof v === "string" ? v : String(v);
  };
  return object(raw, keep);
}

/**
 * The one class the model picked, or null.
 *
 * Classification answers `{"class": "<name>"}` with a name off the list it was
 * handed. A name that is not on that list is not a class the caller can act on
 * — it is the model paraphrasing, or answering in the wrong language — so it is
 * rejected rather than shown as a result. Matching is case-insensitive: the
 * class names are lowercase in the dataset and the model occasionally
 * capitalises one.
 */
export function parseClass(raw: string, classes: Field[]): string | null {
  const byName = new Map(classes.map((c) => [c.key.trim().toLowerCase(), c.key]));
  let picked: string | null = null;
  object(raw, (_out, k, v) => {
    if (k !== "class" || picked !== null || typeof v !== "string") return;
    picked = byName.get(v.trim().toLowerCase()) ?? null;
  });
  return picked;
}

/**
 * The first balanced JSON object in `raw`, fed pair by pair to `keep`.
 *
 * Shared by both tasks because both answer with one object and both get the
 * same slop back: a code fence, a sentence after the closing brace, an object
 * the model never closed. Returns null when `keep` accepted nothing.
 */
function object(
  raw: string,
  keep: (out: Record<string, string>, k: string, v: unknown) => void,
): Record<string, string> | null {
  const body = raw.replace(/^```(?:json)?/i, "").replace(/```\s*$/, "").trim();

  const start = body.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let end = -1;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }

  if (end >= 0) {
    let obj: unknown;
    try {
      obj = JSON.parse(body.slice(start, end));
    } catch {
      return salvage(body, keep);
    }
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) keep(out, k, v);
    return out;
  }
  return salvage(body, keep);
}

/**
 * Recover the pairs from an object the model never closed.
 *
 * A 350M model sometimes runs past the schema, invents extra keys and cycles
 * until the token cap, so no closing brace ever arrives and a strict parse has
 * to give up. The pairs it did emit are still perfectly good, and throwing away
 * six correct fields because the seventh never terminated helps nobody. Only
 * complete "key": "value" pairs are taken, so a value cut mid-string is dropped
 * rather than shown truncated.
 */
function salvage(
  body: string,
  keep: (out: Record<string, string>, k: string, v: unknown) => void,
): Record<string, string> | null {
  const out: Record<string, string> = {};
  const pair = /"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  for (let m = pair.exec(body); m !== null; m = pair.exec(body)) {
    try {
      keep(out, JSON.parse(`"${m[1]}"`), JSON.parse(`"${m[2]}"`));
    } catch {
      // A pair with an escape we cannot decode is not worth guessing at.
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Every gold value in the training set is verbatim page text. A returned value
 * that is not on the page is a hallucination, so the UI flags it rather than
 * showing it as if it were read off the document.
 */
export function isGrounded(value: string, lines: string[]): boolean {
  const page = lines.join(" ").replace(/\s+/g, " ").toLowerCase();
  return page.includes(value.trim().replace(/\s+/g, " ").toLowerCase());
}
