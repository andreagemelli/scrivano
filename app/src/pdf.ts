import { readFile } from "@tauri-apps/plugin-fs";
import { getDocument, GlobalWorkerOptions, OPS } from "pdfjs-dist";
import type { PDFPageProxy } from "pdfjs-dist";
import { ocr } from "./api";
import { SPACELESS } from "./redact";
import type { Dict } from "./i18n";
import type { Box, Line, Page, Run } from "./types";

// Served by vite-plugin-static-copy with the upsert polyfill prepended.
// Do not swap this back to a ?url import: WebKit needs that prefix.
GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

/** pdf.js user space is 72 DPI. The model reads small print, so rasterize at 200. */
const SCALE = 200 / 72;

/** Below this a "text layer" is a stray page number, not the form content. */
const TEXT_LAYER_MIN = 50;

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

function dataUrl(bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(new Blob([bytes], { type: mime }));
  });
}

async function pngBytes(canvas: HTMLCanvasElement, t: Dict): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error(t.encodeFailed);
  return new Uint8Array(await blob.arrayBuffer());
}

/** pdf.js Util.transform, inlined: the matrix that applies `b`, then `a`. */
function mul(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Join text-layer fragments that sit on the same visual line.
 *
 * pdf.js emits one item per styling run, so a single printed line arrives as
 * "Prot." "n." "2024/0004917" "del" "12/09/2024", and a monospaced value can
 * come back one character group at a time. The model was fine-tuned on XFUND
 * entity text where a whole field value is one line, so feeding it fragments is
 * a large distribution shift: it truncated "CASTELVERDE MARITTIMO" to
 * "CASTELVERDE" and returned a codice fiscale as "G R D L S M 8 8 ...".
 *
 * Fragments are grouped by baseline, ordered left to right, and joined with a
 * single space unless they already touch. The merged box is the union, so a
 * highlight covers the whole line rather than one run of it. A fragment with no
 * box cannot be placed, so it stays its own line rather than corrupting one.
 */
export function mergeIntoLines(fragments: Line[]): Line[] {
  const out: Line[] = [];
  let run: Line[] = [];

  const flush = () => {
    if (run.length === 0) return;
    const ordered = [...run].sort((a, b) => (a.box?.x ?? 0) - (b.box?.x ?? 0));
    // Only separate fragments that are actually apart on the page. A letter-spaced
    // run like a codice fiscale arrives one glyph at a time with hairline gaps, and
    // joining those with spaces produced "G R D L S M 8 8 ...". A real word gap is
    // roughly a quarter of the line height, so anything tighter is one token.
    let raw = "";
    let prevRight: number | null = null;
    // Where each fragment starts in the joined text, so part of the line can
    // still be placed on the page after the fragments are gone.
    const starts: { at: number; box: Box }[] = [];
    for (const f of ordered) {
      const gap = f.box && prevRight !== null ? f.box.x - prevRight : null;
      const apart = gap === null || gap > f.box!.h * 0.25;
      if (raw !== "" && apart) raw += " ";
      if (f.box) starts.push({ at: raw.length, box: f.box });
      raw += f.text;
      prevRight = f.box ? f.box.x + f.box.w : prevRight;
    }
    const { text, at } = squash(raw);
    // A fragment's own word runs when it was measured, else the fragment is one.
    const runs = starts.flatMap((st, i) =>
      (ordered[i].runs ?? [{ at: 0, x: st.box.x, w: st.box.w }]).map((r) => ({
        at: at[st.at + r.at],
        x: r.x,
        w: r.w,
      })),
    );
    const measured = ordered.some((f) => f.runs);
    const boxes = ordered.map((f) => f.box).filter((b): b is Box => b !== undefined);
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    out.push({
      text,
      box: {
        x,
        y,
        w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
        h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
      },
      ...((measured || starts.length > 1) && { runs }),
    });
    run = [];
  };

  for (const f of fragments) {
    if (!f.box) {
      flush();
      out.push(f);
      continue;
    }
    const prev = run[run.length - 1];
    // Same line when the baselines overlap vertically by most of their height.
    // Height, not a fixed epsilon, so it scales with the font on the page.
    const sameLine =
      prev?.box !== undefined &&
      Math.abs(prev.box.y + prev.box.h / 2 - (f.box.y + f.box.h / 2)) <
        Math.min(prev.box.h, f.box.h) * 0.6;
    if (!sameLine) flush();
    run.push(f);
  }
  flush();
  return out;
}

/**
 * Where each word of one text item sits. The item's width in the PDF is exact;
 * measuring its prefixes in the item's own font splits that width between the
 * words, so a hidden value can be boxed without spreading a whole line evenly.
 * pdf.js registers every font it renders under the item's `fontName`, and the
 * page is rendered before its text is read, so the measure is the real font.
 */
export function wordRuns(text: string, box: Box, measure: (s: string) => number): Run[] | undefined {
  const total = measure(text);
  if (!(total > 0)) return undefined;
  // A word is a run of non-space characters; in a script written without
  // spaces every character is its own.
  const words: [number, number][] = [];
  for (let i = 0; i < text.length; ) {
    const c = String.fromCodePoint(text.codePointAt(i)!);
    const open = words[words.length - 1];
    if (/\s/.test(c)) {
      // nothing: a space ends the word before it
    } else if (open && open[1] === i && !SPACELESS.test(c) && !SPACELESS.test(text[open[0]])) {
      open[1] = i + c.length;
    } else {
      words.push([i, i + c.length]);
    }
    i += c.length;
  }
  return words.map(([a, b]) => {
    const x0 = measure(text.slice(0, a)) / total;
    const x1 = measure(text.slice(0, b)) / total;
    return { at: a, x: box.x + box.w * x0, w: box.w * (x1 - x0) };
  });
}

/**
 * `raw.replace(/\s+/g, " ").trim()`, which is what the model is fed, plus where
 * each character of `raw` landed in it. The text must not change by a byte: the
 * map is bookkeeping for redaction, not a new normalisation.
 */
export function squash(raw: string): { text: string; at: number[] } {
  let text = "";
  let gap = false;
  const at: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (/\s/.test(c)) {
      gap = text !== "";
      at[i] = text.length;
      continue;
    }
    if (gap) text += " ";
    gap = false;
    at[i] = text.length;
    text += c;
  }
  return { text, at };
}

/**
 * Box for one text item, normalised against the rendered page, or undefined.
 *
 * Item transforms are in unrotated PDF user space with the origin bottom left,
 * so this composes the same flip pdf.js TextLayer uses and divides by the raw
 * page size, which lands straight in 0..1 with no scale involved. `width` is in
 * those same units. The rect is the baseline origin raised by the full font
 * height, which is what a highlight should cover.
 *
 * A rotated page or a rotated/skewed run gets no box: an axis-aligned rect from
 * those numbers would be a guess, and a wrong box is worse than none.
 */
/** Every pdf.js operator that paints an image onto the page. */
const PICTURE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintImageMaskXObjectRepeat,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObjectGroup,
]);

/**
 * Whether a page draws anything its text layer does not carry: a picture (a
 * scanned ID card pasted into a form) or a form field (a value typed into a
 * fillable PDF lives in the field, not in the page's text). Either can show a
 * value the text layer does not, so hiding by the text cannot promise it.
 *
 * ponytail: a warning, not a search. OCR such pages as well if it matters.
 */
async function hasPictures(page: PDFPageProxy): Promise<boolean> {
  const ops = await page.getOperatorList();
  if (ops.fnArray.some((f) => PICTURE_OPS.has(f))) return true;
  return (await page.getAnnotations()).some((a) => a.subtype === "Widget");
}

function itemBox(
  item: { transform: number[]; width: number },
  dims: { pageWidth: number; pageHeight: number; pageX: number; pageY: number },
): Box | undefined {
  const t = mul([1, 0, 0, -1, -dims.pageX, dims.pageY + dims.pageHeight], item.transform);
  if (t[1] !== 0 || t[2] !== 0) return undefined;
  const h = Math.abs(t[3]);
  const x = clamp(t[4] / dims.pageWidth);
  const y = clamp((t[5] - h) / dims.pageHeight);
  const w = clamp((t[4] + item.width) / dims.pageWidth) - x;
  const bh = clamp(t[5] / dims.pageHeight) - y;
  return w > 0 && bh > 0 ? { x, y, w, h: bh } : undefined;
}

export async function loadPages(
  path: string,
  onProgress: (msg: string) => void,
  t: Dict,
): Promise<Page[]> {
  const bytes = await readFile(path);
  const ext = path.split(".").pop()?.toLowerCase() ?? "";

  if (ext !== "pdf") {
    onProgress(t.readingImage);
    const image = await dataUrl(bytes, MIME[ext] ?? "image/png");
    onProgress(t.runningOcr);
    // The Rust side sniffs the format, so jpeg and tiff go over as-is.
    return [{ image, lines: await ocr(bytes), fromTextLayer: false }];
  }

  const pdf = await getDocument({
    data: bytes,
    cMapUrl: "/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/standard_fonts/",
    iccUrl: "/iccs/",
    wasmUrl: "/wasm/",
  }).promise;

  const canvas = document.createElement("canvas");
  const ruler = document.createElement("canvas").getContext("2d")!;
  const pages: Page[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress(t.renderingPage(n, pdf.numPages));
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: SCALE });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;

    const text = await page.getTextContent();
    const dims = viewport.rawDims as {
      pageWidth: number;
      pageHeight: number;
      pageX: number;
      pageY: number;
    };
    const upright = viewport.rotation % 360 === 0;
    const fragments: Line[] = [];
    for (const i of text.items) {
      if (!("str" in i) || i.str.trim() === "") continue;
      // Vertical writing (tategaki) runs down the page, and itemBox is laid out
      // across it, so its rect would sit beside the column. None is better:
      // a value there is masked in the text and the PDF export is refused.
      const box = upright && !text.styles[i.fontName]?.vertical ? itemBox(i, dims) : undefined;
      ruler.font = `100px "${i.fontName}", sans-serif`;
      fragments.push({
        text: i.str,
        box,
        runs: box && wordRuns(i.str, box, (t) => ruler.measureText(t).width),
      });
    }
    const lines = mergeIntoLines(fragments);

    if (lines.reduce((n, l) => n + l.text.length, 0) > TEXT_LAYER_MIN) {
      pages.push({
        image: canvas.toDataURL("image/png"),
        lines,
        fromTextLayer: true,
        pictures: await hasPictures(page),
      });
    } else {
      onProgress(t.ocrOnPage(n, pdf.numPages));
      pages.push({
        image: canvas.toDataURL("image/png"),
        lines: await ocr(await pngBytes(canvas, t)),
        fromTextLayer: false,
      });
    }
  }
  return pages;
}
