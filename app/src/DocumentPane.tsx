import { useEffect, useRef, useState, type ReactNode } from "react";
import { FilePlus } from "@phosphor-icons/react";
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
  onAdd,
}: {
  doc: Doc | null;
  progress: string;
  dragging: boolean;
  dropError: string;
  /** Text the JSON pane is pointing at, or null. Matched against the OCR lines. */
  highlight: string | null;
  onAdd: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"page" | "text">("page");
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
      </header>

      <div className={dragging && doc ? "panel-body drag-ring" : "panel-body"}>
        {/* With no document the same message lives inside the drop zone. */}
        {dropError !== "" && doc && <p className="err">{dropError}</p>}

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
                  <img className="page-img" src={p.image} alt={t.page(i + 1)} />
                  <div className="marks" aria-hidden="true">
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
                    <span className="line-text">{paint(l.text, needle, claim)}</span>
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
