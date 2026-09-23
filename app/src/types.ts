/** Shared shapes. Kept in one file so the Rust bridge, the UI and the store agree. */

/** A schema row, and also a class row: both are a name plus what it means. */
export type Field = {
  key: string;
  description: string;
  /**
   * The eye is closed on this field: its value is masked in the JSON, and
   * wherever it occurs on the page it is blacked out, in the image and in the
   * text. On the field rather than on one document, so it is part of the schema
   * the next document inherits. Never reaches the model.
   */
  hidden?: boolean;
};

/** The two things the model was fine-tuned to do. */
export type Task = "extract" | "classify";

/** The language the interface is written in. Two, because someone writes them. */
export type Lang = "en" | "it";

/**
 * The language the DOCUMENT is in, which is the language its schema keys, their
 * descriptions and the class names must be written in — the fine-tune saw prompt
 * and page in the same language, and mixing them costs real accuracy. Eight,
 * because that is what the model knows; it is not the same choice as `Lang`.
 */
export type DocLang = "en" | "it" | "de" | "es" | "fr" | "pt" | "zh" | "ja";

/** Normalised to 0..1 against the rendered page image, so the UI never needs the pixel size. */
export type Box = { x: number; y: number; w: number; h: number };

/**
 * Where one word — or one character, from the OCR — of a line sits: from UTF-16
 * offset `at` of the line's text to the end of that word, drawn between `x` and
 * `x + w` across the page. ocr.rs emits the same shape, counting the same units.
 */
export type Run = { at: number; x: number; w: number };

/** One text region. `box` is absent when the source could not give a reliable one. */
export type Line = {
  text: string;
  box?: Box;
  /**
   * Where its words sit: from the recognizer's own character columns for an
   * OCR line, from the PDF item's own font for a text-layer one. A hidden value
   * is boxed by these. Absent when there was nothing trustworthy to take them
   * from, and then a hidden value on this line is blacked out with the line.
   */
  runs?: Run[];
};

/** One rasterized page plus the OCR lines found on it, in detection order. */
export type Page = {
  /** data: URL of the rendered page, shown in the document pane. */
  image: string;
  /** One entry per detected text region. Order is the model's input order. */
  lines: Line[];
  /** true when the lines came from a PDF text layer instead of OCR. */
  fromTextLayer: boolean;
  /**
   * A text-layer page that also draws pictures or form fields, which can show a
   * value its text does not carry. Absent on OCR pages: those read the pixels.
   */
  pictures?: boolean;
};

export type Status =
  | "empty"
  | "reading"
  | "classifying"
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
  /**
   * The class the model last assigned, on open or when asked again, as the name
   * shown in the class list. Absent when it was never asked, or its last answer
   * was not a class on the list; a run that failed keeps the one before.
   */
  docClass?: string;
  /** The project this document was opened into. Absent on 0.2.x history. */
  projectId?: string;
  /**
   * This one document's language, when it is not simply its folder's: detected
   * from the page when it opened, or chosen in the extraction settings. A German
   * page in a folder of Italian ones is a real thing and it needs a German
   * schema: the project's language is a default, not a rule.
   */
  docLang?: DocLang;
  /**
   * What detection made of the page when it opened, so the language shown can
   * say where it came from. null: detection ran and could not tell, so the
   * folder's stands. Absent: detection was off, or the document predates it.
   */
  detected?: { lang: DocLang; p: number } | null;
};

/**
 * A folder of documents that share a way of being classified.
 *
 * Classification is the one setting that is genuinely about a BATCH rather than
 * about a document or about the model: a folder of invoices wants a different
 * class list, or none at all, from a folder of municipal forms. So it belongs to
 * the folder, and not to the extraction settings where it started out.
 */
export type Project = {
  id: string;
  /** Empty means the first project, which is named by the interface language. */
  name: string;
  /**
   * The language the documents in here are written in — the fallback, while
   * detection is on, for a page whose own cannot be told. It is what a document
   * starts from then: the class names the model is shown and the preset schema.
   * The folder's class list is written in it, and every answer is filed under
   * it, whatever language the page turned out to be in.
   */
  docLang: DocLang;
  /**
   * Detect each document's language as it opens. The folder's language is then
   * the fallback, for a page in none of the eight or one detection is unsure of.
   */
  detectLang: boolean;
  /** Ask the model for a class as soon as a document is opened in here. */
  classify: boolean;
  /** The classes it may pick from. Editable per project, so it is stored. */
  classes: Field[];
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

/**
 * Decoding for the classification run. Greedy like extraction, but capped
 * hard: the answer is one short object, and a model that starts looping should
 * cost a moment, not the full token budget.
 */
export const CLASSIFY_SAMPLING: Sampling = { ...DEFAULT_SAMPLING, maxTokens: 64 };
