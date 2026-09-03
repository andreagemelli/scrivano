/** Shared shapes. Kept in one file so the Rust bridge, the UI and the store agree. */

export type Field = { key: string; description: string };

/** Normalised to 0..1 against the rendered page image, so the UI never needs the pixel size. */
export type Box = { x: number; y: number; w: number; h: number };

/** One text region. `box` is absent when the source could not give a reliable one. */
export type Line = { text: string; box?: Box };

/** One rasterized page plus the OCR lines found on it, in detection order. */
export type Page = {
  /** data: URL of the rendered page, shown in the document pane. */
  image: string;
  /** One entry per detected text region. Order is the model's input order. */
  lines: Line[];
  /** true when the lines came from a PDF text layer instead of OCR. */
  fromTextLayer: boolean;
};

export type Status =
  | "empty"
  | "reading"
  | "ready"
  | "extracting"
  | "done"
  | "failed";

export type Doc = {
  id: string;
  name: string;
  /** ms since epoch, stamped when the document was added. */
  addedAt: number;
  pages: Page[];
  fields: Field[];
  status: Status;
  /** Raw model output, kept so a parse failure is inspectable. */
  raw?: string;
  result?: Record<string, string>;
  error?: string;
  /** Absent on documents saved before sampling was configurable. */
  sampling?: Sampling;
  /** Decode rate of the last run, tokens per second. Absent if it never ran. */
  tps?: number;
};

/** Decoding knobs sent to llama.cpp with every run. Mirrors `Sampling` in llm.rs. */
export type Sampling = {
  /** 0 means greedy: no sampling at all, so the same input gives the same output. */
  temperature: number;
  /** 0 disables top-k. */
  topK: number;
  /** 1 disables top-p. */
  topP: number;
  maxTokens: number;
  seed: number;
};

export const DEFAULT_SAMPLING: Sampling = {
  temperature: 0,
  topK: 0,
  topP: 1,
  maxTokens: 1024,
  seed: 42,
};
