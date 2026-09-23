import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, FilePdf, FilePlus, Warning } from "@phosphor-icons/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import {
  REDACTED,
  boxesOn,
  maskedText,
  paintPage,
  redactedPdf,
  unplaced,
  type Span,
  type Spans,
} from "./redact";
import { useT } from "./i18n";
import type { Doc } from "./types";

/**
 * Every occurrence of `needle` in one line, wrapped in a mark. `claim` hands the
 * very first mark on the page its ref, so the pane can scroll to it.
 */
function paint(
  line: string,
  needle: string,
  claim: () => ((el: HTMLElement | null) => void) | undefined,
): ReactNode {
  if (needle === "") return line;
  const hay = line.toLowerCase();
  const out: ReactNode[] = [];
  let at = 0;
  for (;;) {
    const i = hay.indexOf(needle, at);
    if (i < 0) break;
    out.push(line.slice(at, i));
    out.push(
      <mark className="hit" key={i} ref={claim()}>
        {line.slice(i, i + needle.length)}
      </mark>,
    );
    at = i + needle.length;
  }
  if (out.length === 0) return line;
  out.push(line.slice(at));
  return out;
}

/**
 * One line of the text view. A hidden stretch is drawn as the mask it leaves
 * the app as, so what you read here is what "copy the text" hands over; the
 * rest is painted for the hover as before.
 */
function lineView(
  text: string,
  spans: Span[],
  needle: string,
  claim: () => ((el: HTMLElement | null) => void) | undefined,
): ReactNode {
  if (spans.length === 0) return paint(text, needle, claim);
  const out: ReactNode[] = [];
  let at = 0;
  spans.forEach(([s, e], i) => {
    out.push(<Fragment key={`v${i}`}>{paint(text.slice(at, s), needle, claim)}</Fragment>);
    out.push(
      <span className="redacted" key={`r${i}`}>
        {REDACTED}
      </span>,
    );
    at = e;
  });
  out.push(<Fragment key="tail">{paint(text.slice(at), needle, claim)}</Fragment>);
  return out;
}

/** The one match rule, so the page and the text views agree on what is a hit. */
function hits(line: string, needle: string): boolean {
  return needle !== "" && line.toLowerCase().includes(needle);
}

export default function DocumentPane({
  doc,
  progress,
  dragging,
  dropError,
  highlight,
  spans,
  hiddenCount,
  notFound,
  unsettled,
  onAdd,
}: {
  doc: Doc | null;
  progress: string;
  dragging: boolean;
  dropError: string;
  /** Text the JSON pane is pointing at, or null. Matched against the OCR lines. */
  highlight: string | null;
  /** Per page, per line: what to black out. Empty when nothing is hidden. */
  spans: Spans;
  /** How many hidden values were found on the page, for the export labels. */
  hiddenCount: number;
  /** How many hidden values were found nowhere on the page, so nothing was painted over. */
  notFound: number;
  /** A field is hidden but there is no extraction to take its value from. */
  unsettled: boolean;
  onAdd: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"page" | "text">("page");
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  // The pages with their boxes painted into the pixels, one object URL per page
  // that has any. Shown instead of the original, so what can be dragged or
  // copied off the screen is the painted picture, not the one under an overlay.
  const [painted, setPainted] = useState<(string | undefined)[]>([]);
  const first = useRef<HTMLElement | null>(null);
  const hasResult = doc?.result !== undefined;
  const docId = doc?.id;
  const hasBoxes = doc?.pages.some((p) => p.lines.some((l) => l.box)) ?? false;

  // Both views can point at a match now, so open on the page: it shows the
  // value in its place on the document. Without boxes (old history, or a text
  // layer we could not measure) the page can show nothing, so text it is.
  useEffect(() => {
    if (hasResult) setTab(hasBoxes ? "page" : "text");
  }, [hasResult, hasBoxes, docId]);

  const needle = (highlight ?? "").trim().toLowerCase();

  // Keyed on what the boxes are, not on the spans array, which is new every render.
  const paintKey = JSON.stringify(spans);
  useEffect(() => {
    const pages = doc?.pages ?? [];
    const urls: string[] = [];
    let live = true;
    // The last set belongs to other boxes, and its URLs are revoked by now. The
    // overlay below is drawn from the same boxes, so nothing shows meanwhile.
    setPainted([]);
    void (async () => {
      const out: (string | undefined)[] = [];
      for (const [i, p] of pages.entries()) {
        const boxes = boxesOn(p, spans[i]);
        if (boxes.length === 0) {
          out.push(undefined);
          continue;
        }
        const url = URL.createObjectURL((await paintPage(p, boxes, "image/png")).blob);
        urls.push(url);
        out.push(url);
      }
      if (live) setPainted(out);
    })().catch((e) => console.error("painting the hidden values failed", e));
    return () => {
      live = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [doc?.pages, paintKey]);

  useEffect(() => {
    if (needle !== "") first.current?.scrollIntoView({ block: "center" });
  }, [needle]);

  // Reset per render: the first mark drawn below is the one we scroll to.
  let taken = false;
  function claim() {
    if (taken) return undefined;
    taken = true;
    return (el: HTMLElement | null) => {
      first.current = el;
    };
  }

  const pageCount = doc?.pages.length ?? 0;
  const lineCount = doc?.pages.reduce((n, p) => n + p.lines.length, 0) ?? 0;
  // A hidden value with nowhere to paint the box. The text masks it, but a PDF
  // would show it, so the PDF is not offered until it can be made safely.
  const lost = doc ? unplaced(doc.pages, spans) : 0;
  const exportable = doc !== null && pageCount > 0 && doc.status !== "reading";
  // Why an export is refused, or "". A field hidden before there is a value to
  // hide refuses both; a value that cannot be placed refuses only the PDF.
  const textBlock = unsettled ? t.hiddenUnsettled : "";
  const pdfBlock = textBlock || (lost > 0 ? t.unplaced(lost) : "");
  // Pages whose text layer is not all there is to them, worth a look before sharing.
  const pictures = hiddenCount > 0 && (doc?.pages.some((p) => p.pictures) ?? false);

  async function copyText() {
    if (!doc || textBlock) return;
    setError("");
    try {
      await writeText(maskedText(doc.pages, spans));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function downloadPdf() {
    if (!doc || pdfBlock || exporting) return;
    setError("");
    try {
      const path = await save({
        defaultPath: `${doc.name.replace(/\.[^.]+$/, "")}${hiddenCount > 0 ? "-redacted" : ""}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!path) return;
      setExporting(true);
      await writeFile(path, await redactedPdf(doc.pages, spans));
    } catch (e) {
      setError(t.pdfFailed(e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className={dragging ? "panel doc-pane dragging" : "panel doc-pane"}>
      <header className="panel-head">
        <h2>{t.document}</h2>
        {pageCount > 0 && (
          <span className="muted">
            {t.pages(pageCount)}, {t.lines(lineCount)}
          </span>
        )}
        <span className="grow" />
        {pageCount > 0 && (
          <div className="seg">
            <button aria-pressed={tab === "page"} onClick={() => setTab("page")}>
              {t.pageTab}
            </button>
            <button aria-pressed={tab === "text"} onClick={() => setTab("text")}>
              {t.textTab}
            </button>
          </div>
        )}
        {/* After the switch, as in the extraction pane, so at the narrowest
            window it is the icons that wrap and they stay right-aligned.
            aria-disabled rather than disabled: WebKit sends no pointer events
            to a disabled button, and the hint is the explanation. */}
        {exportable && (
          <span className="panel-actions">
            {copied && <span className="muted">{t.copied}</span>}
            <button
              className="icon-btn"
              aria-label={textBlock || t.copyText(hiddenCount)}
              aria-disabled={textBlock !== "" || undefined}
              data-hint={textBlock || t.copyText(hiddenCount)}
              onClick={copyText}
            >
              <Copy size={16} weight="regular" />
            </button>
            <button
              className="icon-btn"
              aria-label={pdfBlock || t.downloadPdf(hiddenCount)}
              aria-disabled={pdfBlock !== "" || exporting || undefined}
              data-hint={pdfBlock || t.downloadPdf(hiddenCount)}
              onClick={downloadPdf}
            >
              <FilePdf size={16} weight="regular" />
            </button>
          </span>
        )}
      </header>

      <div className={dragging && doc ? "panel-body drag-ring" : "panel-body"}>
        {/* With no document the same message lives inside the drop zone. */}
        {dropError !== "" && doc && <p className="err">{dropError}</p>}
        {error !== "" && <p className="err">{error}</p>}
        {/* Everything that stands between a hidden value and a safe export, said
            where the export is. One note each, loudest first. */}
        {exportable && unsettled && (
          <p className="warn-note">
            <Warning size={14} weight="regular" />
            {t.hiddenUnsettled}
          </p>
        )}
        {exportable && !unsettled && lost > 0 && (
          <p className="warn-note">
            <Warning size={14} weight="regular" />
            {t.unplaced(lost)}
          </p>
        )}
        {exportable && !unsettled && notFound > 0 && (
          <p className="warn-note">
            <Warning size={14} weight="regular" />
            {t.hiddenNotFound(notFound)}
          </p>
        )}
        {exportable && !unsettled && pictures && (
          <p className="warn-note">
            <Warning size={14} weight="regular" />
            {t.hiddenPictures}
          </p>
        )}

        {!doc && (
          <div className="drop-zone">
            <FilePlus size={34} weight="light" />
            <p className="lead">
              {dragging ? t.dropToOpen : t.dropHere}
            </p>
            <button className="btn primary" onClick={onAdd}>
              {t.chooseFile}
            </button>
            <p className="note">{t.formats}</p>
            {dropError !== "" && <p className="note err-text">{dropError}</p>}
          </div>
        )}

        {doc?.status === "reading" && (
          <div className="skel">
            <p className="hint">{progress || t.readingFile}</p>
            <div className="skel-page" />
            <div className="skel-line" style={{ width: "70%" }} />
            <div className="skel-line" style={{ width: "45%" }} />
          </div>
        )}

        {doc && doc.pages.length === 0 && doc.status === "failed" && (
          <p className="err">{t.readFailed(doc.error ?? "")}</p>
        )}

        {doc && pageCount > 0 && tab === "page" && (
          <div className="pages">
            {doc.pages.map((p, i) => (
              <div className="page" key={i}>
                <div className="page-num">{t.page(i + 1)}</div>
                {/* Percentages off the normalised box, so the overlay follows the
                    image at any render width and needs no resize listener. A line
                    without a box is not drawn: a guessed rect points at nothing. */}
                <div className="shot">
                  <img
                    className="page-img"
                    src={painted[i] ?? p.image}
                    alt={t.page(i + 1)}
                    draggable={false}
                  />
                  <div className="marks" aria-hidden="true">
                    {/* Painted before the hover marks, so pointing at a hidden
                        value still shows where it is without showing it. */}
                    {boxesOn(p, spans[i]).map((b, n) => (
                      <div
                        className="blackout"
                        key={`b${n}`}
                        style={{
                          left: `${b.x * 100}%`,
                          top: `${b.y * 100}%`,
                          width: `${b.w * 100}%`,
                          height: `${b.h * 100}%`,
                        }}
                      />
                    ))}
                    {p.lines.map((l, n) =>
                      l.box && hits(l.text, needle) ? (
                        <div
                          className="mark"
                          key={n}
                          ref={claim()}
                          style={{
                            left: `${l.box.x * 100}%`,
                            top: `${l.box.y * 100}%`,
                            width: `${l.box.w * 100}%`,
                            height: `${l.box.h * 100}%`,
                          }}
                        />
                      ) : null,
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {doc && pageCount > 0 && tab === "text" && (
          <div className="lines">
            {doc.pages.map((p, i) => (
              <div className="text-block" key={i}>
                <div className="page-num">
                  {t.page(i + 1)}
                  <span className="provenance">{p.fromTextLayer ? t.fromTextLayer : t.fromOcr}</span>
                </div>
                {p.lines.length === 0 && <div className="hint">{t.emptyPage}</div>}
                {p.lines.map((l, n) => (
                  <div className="line" key={n}>
                    <span className="ln">{n + 1}</span>
                    <span className="line-text">{lineView(l.text, spans[i]?.[n] ?? [], needle, claim)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
