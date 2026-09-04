import { readFile } from "@tauri-apps/plugin-fs";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { ocr } from "./api";
import type { Dict } from "./i18n";
import type { Box, Line, Page } from "./types";

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
    let text = "";
    let prevRight: number | null = null;
    for (const f of ordered) {
      const gap = f.box && prevRight !== null ? f.box.x - prevRight : null;
      const apart = gap === null || gap > f.box!.h * 0.25;
      if (text !== "" && apart) text += " ";
      text += f.text;
      prevRight = f.box ? f.box.x + f.box.w : prevRight;
    }
    text = text.replace(/\s+/g, " ").trim();
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
      fragments.push({ text: i.str, box: upright ? itemBox(i, dims) : undefined });
    }
    const lines = mergeIntoLines(fragments);

    if (lines.reduce((n, l) => n + l.text.length, 0) > TEXT_LAYER_MIN) {
      pages.push({ image: canvas.toDataURL("image/png"), lines, fromTextLayer: true });
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
