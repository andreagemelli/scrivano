/**
 * Hiding a value for real: in the JSON, in the page text, and in the page image.
 *
 * The point is a document you can hand to another agent. So a hidden value is
 * not a CSS blur over something still sitting in the DOM: every text that leaves
 * the app has it replaced, and the PDF is rebuilt from pixels with the value
 * painted over, so there is no text layer underneath to copy it back out of.
 *
 * What gets hidden is decided by the extraction: a field with its eye closed
 * hides the value the model returned for it, wherever that value occurs on the
 * page. It is only as good as that value — which is why a hidden value that
 * cannot be found on the page is reported rather than quietly left visible.
 */
import type { Box, Field, Line, Page } from "./types";

/** What a hidden value becomes in every text that leaves the app. Fixed length, so it does not leak one. */
export const REDACTED = "[REDACTED]";

/** A stretch [start, end) of one line's text. */
export type Span = [number, number];

/** Per page, per line: the stretches to hide. */
export type Spans = Span[][][];

/** Scripts written without spaces between words, where every character stands alone. */
export const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

/** Letters and digits that sit in a space-separated script, where a word has edges. */
const WORD = /[\p{L}\p{N}]/u;
const wordy = (c: string | undefined) => c !== undefined && WORD.test(c) && !SPACELESS.test(c);

/**
 * Below this many characters a value only matches as a whole word. Hiding a
 * one-letter sex or a two-digit age must not black out every M and every 12
 * on the page; above it a substring match is what you want, since OCR glues
 * values to their labels ("Nome:MARIO").
 */
const WHOLE_WORD_BELOW = 4;

/** The values of the fields whose eye is closed, as the result holds them now. */
export function hiddenValues(fields: Field[], result: Record<string, string> | undefined): string[] {
  if (!result) return [];
  return fields
    .filter((f) => f.hidden && typeof result[f.key] === "string" && result[f.key].trim() !== "")
    .map((f) => result[f.key]);
}

/**
 * The JSON that leaves the app: the rows on screen, in schema order, hidden ones
 * masked. Built from the schema and not from the result, because the two drift
 * apart the moment a key is renamed or removed after a run, and a result key
 * with no field behind it is shown nowhere — so it must not be copied either.
 */
export function shownResult(
  result: Record<string, string>,
  fields: Field[],
): Record<string, string> {
  return Object.fromEntries(
    fields.filter((f) => f.key in result).map((f) => [f.key, f.hidden ? REDACTED : result[f.key]]),
  );
}

/**
 * The page as one searchable string, with a way back to the lines.
 *
 * Same normalisation as `isGrounded`: lines joined by a space, whitespace
 * collapsed, lowercase. Lowercasing is per character, since one character can
 * lowercase to two and the index map has to stay honest.
 */
function flatten(lines: Line[]) {
  let hay = "";
  const line: number[] = [];
  const at: number[] = [];
  const len: number[] = [];
  const push = (s: string, li: number, i: number, n: number) => {
    for (const u of s) {
      for (let k = 0; k < u.length; k++) {
        line.push(li);
        at.push(i);
        len.push(n);
      }
      hay += u;
    }
  };
  lines.forEach((l, li) => {
    if (hay !== "" && !hay.endsWith(" ")) push(" ", -1, 0, 0);
    for (let i = 0; i < l.text.length; ) {
      const c = String.fromCodePoint(l.text.codePointAt(i)!);
      if (/\s/.test(c)) {
        if (hay !== "" && !hay.endsWith(" ")) push(" ", li, i, c.length);
      } else {
        push(c.toLowerCase(), li, i, c.length);
      }
      i += c.length;
    }
  });
  return { hay, line, at, len };
}

function needleOf(value: string): string {
  let out = "";
  for (const c of value.trim().replace(/\s+/g, " ")) out += c.toLowerCase();
  return out;
}

/**
 * Where each value occurs, as stretches of the lines it covers. A value may run
 * across a line break, since `isGrounded` accepts that too. Every occurrence is
 * hidden, not only the first: a name printed twice is still a name.
 */
export function locate(pages: Page[], values: string[]): { spans: Spans; missing: string[] } {
  const found = new Set<string>();
  const spans = pages.map((p) => {
    const out: Span[][] = p.lines.map(() => []);
    const flat = flatten(p.lines);
    for (const value of values) {
      const needle = needleOf(value);
      if (needle === "") continue;
      const chars = [...needle];
      const whole = chars.length < WHOLE_WORD_BELOW;
      for (let k = flat.hay.indexOf(needle); k >= 0; k = flat.hay.indexOf(needle, k + 1)) {
        const end = k + needle.length;
        if (whole) {
          const before = [...flat.hay.slice(0, k)].pop();
          const after = [...flat.hay.slice(end)][0];
          if ((wordy(chars[0]) && wordy(before)) || (wordy(chars[chars.length - 1]) && wordy(after))) {
            continue;
          }
        }
        found.add(value);
        // A match is contiguous in the flat string, so its share of each line
        // it touches is contiguous too: the lowest start and highest end.
        const per = new Map<number, Span>();
        for (let j = k; j < end; j++) {
          const li = flat.line[j];
          if (li < 0) continue;
          const s = per.get(li);
          const a = flat.at[j];
          const b = a + flat.len[j];
          per.set(li, s ? [Math.min(s[0], a), Math.max(s[1], b)] : [a, b]);
        }
        for (const [li, s] of per) out[li].push(s);
      }
    }
    return out.map(merge);
  });
  return { spans, missing: values.filter((v) => !found.has(v)) };
}

/** Overlapping or touching stretches become one, in order. */
function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
}

/** One line with its hidden stretches replaced. */
export function maskLine(text: string, spans: Span[]): string {
  let out = "";
  let at = 0;
  for (const [s, e] of spans) {
    out += text.slice(at, s) + REDACTED;
    at = e;
  }
  return out + text.slice(at);
}

/** The whole document as text, hidden values replaced: what "copy the text" hands over. */
export function maskedText(pages: Page[], spans: Spans): string {
  return pages
    .map((p, pi) => p.lines.map((l, li) => maskLine(l.text, spans[pi]?.[li] ?? [])).join("\n"))
    .join("\n\n");
}

/**
 * How many lines hold a hidden value but have no position on the page. Those
 * can be masked in the text but not painted over in the image, so a PDF built
 * now would still show them.
 */
export function unplaced(pages: Page[], spans: Spans): number {
  let n = 0;
  pages.forEach((p, pi) =>
    p.lines.forEach((l, li) => {
      if (!l.box && (spans[pi]?.[li]?.length ?? 0) > 0) n++;
    }),
  );
  return n;
}

// ---------------------------------------------------------------------------
// Where a stretch of a line sits on the page image.
// ---------------------------------------------------------------------------

/** East Asian wide characters take two columns: ignoring that puts every kanji half a character left of where it is. */
const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff01-\uff60\uffe0-\uffe6]/u;

/** Width of text[a..b) in half-width columns. */
function cols(text: string, a: number, b: number): number {
  let n = 0;
  for (const c of text.slice(a, b)) n += WIDE.test(c) ? 2 : 1;
  return n;
}

/**
 * How far past its estimated edges a box reaches, in columns of the word it
 * ends in. Word positions come from the page (the recognizer's own character
 * columns, or the PDF's own font), but inside a word the characters are spread
 * evenly, and an "i" and an "M" are not the same width. Measured on a real page
 * with per-word runs: 1.5 under-covered none of 306 words, 1.0 two of them. A
 * box a little too wide hides a letter of a label; one too narrow leaks a
 * letter of a name, so the slack goes on the outside.
 */
const PAD = 1.5;

/**
 * Above and below the line box, as a share of its height. More below: a PDF
 * text item's box stops at the baseline, and a g or a p hangs a fifth of an em
 * under it, so an even pad left the tails of "Giuseppe" legible under the bar.
 */
const V_UP = 0.15;
const V_DOWN = 0.3;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Where text[s..e) of a line sits on the page.
 *
 * With word positions, the box starts in the word the stretch starts in and
 * ends in the word it ends in, so a wide gap between a label and a value is
 * never mistaken for text. Without them the whole line is blacked out: spreading
 * a line's characters evenly across its box was measured to leak — 29 of 306
 * words on a real page, by up to fifteen characters where the OCR dropped text
 * the box still spans.
 */
export function place(line: Line, [s, e]: Span): Box | undefined {
  const box = line.box;
  if (!box) return undefined;
  const y = clamp01(box.y - box.h * V_UP);
  const h = clamp01(box.y + box.h * (1 + V_DOWN)) - y;
  const runs = line.runs;
  if (!runs?.length) return { x: box.x, y, w: box.w, h };
  const text = line.text;
  /** x of character boundary `c`, inside the run holding character `k`. */
  const xAt = (c: number, k: number) => {
    let r = 0;
    while (r + 1 < runs.length && runs[r + 1].at <= k) r++;
    const run = runs[r];
    // A run is a word: the spaces before the next one are not part of its width.
    const stop = run.at + text.slice(run.at, runs[r + 1]?.at ?? text.length).trimEnd().length;
    const unit = run.w / (cols(text, run.at, stop) || 1);
    return { x: run.x + unit * cols(text, run.at, Math.min(Math.max(c, run.at), stop)), unit };
  };
  const a = xAt(s, s);
  const b = xAt(e, e - 1);
  const x = clamp01(Math.min(a.x - PAD * a.unit, s <= 0 ? box.x : 1));
  const right = clamp01(Math.max(b.x + PAD * b.unit, e >= text.length ? box.x + box.w : 0));
  return { x, y, w: right - x, h };
}

/** Every box to paint on one page. */
export function boxesOn(page: Page, spans: Span[][] | undefined): Box[] {
  if (!spans) return [];
  return page.lines.flatMap((l, li) =>
    (spans[li] ?? []).map((s) => place(l, s)).filter((b): b is Box => b !== undefined),
  );
}

// ---------------------------------------------------------------------------
// The PDF. A page is a JPEG of the rendered page with the boxes already painted
// into its pixels, and nothing else: no text layer, no metadata from the source.
// ---------------------------------------------------------------------------

/** The DPI pages are rendered at in pdf.ts, so a page comes out at its paper size. */
const DPI = 200;

/**
 * A minimal PDF 1.4: one full-page image per page. Written by hand because it is
 * forty lines, and a PDF library would be the largest dependency in the app for
 * the one thing it does here.
 */
export function pdfFromJpegs(pages: { jpeg: Uint8Array; width: number; height: number }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const put = (x: string | Uint8Array) => {
    const b = typeof x === "string" ? enc.encode(x) : x;
    chunks.push(b);
    size += b.length;
  };
  const obj = (n: number, dict: string, stream?: Uint8Array) => {
    offsets[n] = size;
    put(`${n} 0 obj\n${dict}\n`);
    if (stream) {
      put("stream\n");
      put(stream);
      put("\nendstream\n");
    }
    put("endobj\n");
  };

  // The second line marks the file as binary for tools that sniff for it.
  put("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, i) => `${3 + 3 * i} 0 R`).join(" ");
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const [page, image, content] = [3 + 3 * i, 4 + 3 * i, 5 + 3 * i];
    const w = ((p.width * 72) / DPI).toFixed(2);
    const h = ((p.height * 72) / DPI).toFixed(2);
    const draw = enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im Do Q`);
    obj(
      page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im ${image} 0 R >> >> /Contents ${content} 0 R >>`,
    );
    obj(
      image,
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`,
      p.jpeg,
    );
    obj(content, `<< /Length ${draw.length} >>`, draw);
  });

  const xref = size;
  const count = 3 + 3 * pages.length;
  put(
    `xref\n0 ${count}\n0000000000 65535 f \n` +
      offsets
        .slice(1)
        .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
        .join(""),
  );
  put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * One page with its boxes painted into the pixels, as an image file. The page
 * view shows this rather than the original under an overlay, so dragging or
 * copying the picture off the screen takes the painted one; the PDF is built
 * from the same pixels. Browser only: it decodes the page onto a canvas.
 */
export async function paintPage(page: Page, boxes: Box[], type: "image/png" | "image/jpeg") {
  const img = new Image();
  img.src = page.image;
  await img.decode();
  const [W, H] = [img.naturalWidth, img.naturalHeight];
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2D canvas");
  // JPEG has no alpha, and a transparent PNG would otherwise come out black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = "#000";
  // Outward to whole pixels, so a box never stops a hair short of a glyph.
  for (const b of boxes) {
    const x = Math.floor(b.x * W);
    const y = Math.floor(b.y * H);
    ctx.fillRect(x, y, Math.ceil((b.x + b.w) * W) - x, Math.ceil((b.y + b.h) * H) - y);
  }
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
  if (!blob) throw new Error("could not encode the page");
  return { blob, width: W, height: H };
}

/** The document as a PDF, with every hidden value painted over in the pixels. */
export async function redactedPdf(pages: Page[], spans: Spans): Promise<Uint8Array> {
  const out = [];
  for (const [pi, page] of pages.entries()) {
    const { blob, width, height } = await paintPage(page, boxesOn(page, spans[pi]), "image/jpeg");
    out.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width, height });
  }
  return pdfFromJpegs(out);
}
