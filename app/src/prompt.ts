/**
 * The model contract. Mirrors local/data.py byte for byte.
 *
 * Verified against the published dataset andreagemelli/xfund-kie-it (val split,
 * row it_val_0): the system message is SYSTEM_PROMPT_DEFAULT followed by one
 * "key: description.\n" per field, and the user message is the page lines
 * joined with "\n".
 *
 * If extraction quality is wrong, look here first. This is the only place the
 * prompt is built.
 */
import type { Field } from "./types";

/** const.py SYTEM_PROMPT_DEFAULT. 127 chars, ends with two newlines. Do not trim. */
const SYSTEM_PROMPT_DEFAULT =
  "Identify and extract information matching the following schema.\n" +
  "Return data as a JSON object. Missing data should be omitted.\n\n";

/**
 * System message content. Descriptions carry no terminal period in schema.json,
 * so exactly one "." is appended, then a newline. Nothing separates the lines.
 */
export function buildSystem(fields: Field[]): string {
  return (
    SYSTEM_PROMPT_DEFAULT +
    fields.map((f) => `${f.key}: ${f.description}.\n`).join("")
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
export function buildPrompt(fields: Field[], lines: string[]): string {
  return (
    "<|startoftext|>" +
    "<|im_start|>system\n" +
    buildSystem(fields) +
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
  const keep = (out: Record<string, string>, k: string, v: unknown) => {
    if (!wanted.has(k)) return; // the model invents keys now and then
    if (v === null || v === undefined || v === "") return; // "Missing data should be omitted"
    if (k in out) return; // a repetition loop repeats keys; the first answer is the considered one
    out[k] = typeof v === "string" ? v : String(v);
  };

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
