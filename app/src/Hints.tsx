import { useEffect, useState } from "react";

/**
 * Tooltips, because WKWebView does not draw the `title` attribute.
 *
 * On macOS the app runs in a WKWebView, which — unlike Chrome and Firefox —
 * renders no tooltip for `title`. Every explanation the UI had was therefore
 * invisible in the shipped app while looking perfectly fine in a dev browser.
 * That is the whole reason this file exists.
 *
 * One listener at the document root and one bubble, rather than a wrapper
 * component per call site: a wrapper is an extra element in someone else's flex
 * row, and this UI is full of flex rows that were spaced by hand. A call site
 * only carries `data-hint="..."`, so adding an explanation never moves a pixel
 * of layout.
 *
 * Hover and keyboard focus both open it, Escape and scrolling close it. The
 * bubble is aria-hidden: anything that needs one already carries an aria-label
 * or its own text, and a tooltip that repeats them just makes a screen reader
 * say everything twice.
 */

/** Long enough that sweeping the pointer across a toolbar stays quiet. */
const OPEN_DELAY = 140;

/** Keeps the bubble off the window edge. Matches the app's 8px spacing step. */
const EDGE = 8;

type Bubble = { text: string; x: number; y: number; above: boolean };

/** Where the bubble goes for a given trigger, clamped into the window. */
function place(el: Element, text: string): Bubble {
  const r = el.getBoundingClientRect();
  // The width the bubble will settle at, mirroring the CSS max-width. Knowing
  // it here is what lets the horizontal clamp happen before the first paint,
  // so a bubble near the right edge never flashes off-screen and jumps back.
  const width = Math.min(260, Math.max(120, text.length * 6.6));
  const half = width / 2;
  // Stay inside the drawer when the trigger is in it. Clamping to the window is
  // correct but reads as unmoored: a bubble centred on a control near the
  // drawer's left edge hangs half of itself over the dimmed page behind it.
  const box = el.closest(".drawer")?.getBoundingClientRect();
  const left = Math.max(box?.left ?? 0, 0) + EDGE + half;
  const right = Math.min(box?.right ?? window.innerWidth, window.innerWidth) - EDGE - half;
  const x = Math.min(Math.max(r.left + r.width / 2, left), Math.max(left, right));
  // Below by default, above when there is no room. The drawer's help icons sit
  // near the bottom of a long scroll often enough for this to matter.
  const above = r.bottom + followingHeight(text) > window.innerHeight - EDGE;
  return { text, x, y: above ? r.top - EDGE : r.bottom + EDGE, above };
}

/** Rough bubble height, only ever used to decide which side to open on. */
function followingHeight(text: string): number {
  return 28 + Math.floor(text.length / 38) * 18;
}

export default function Hints() {
  const [bubble, setBubble] = useState<Bubble | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    let open: Element | null = null;

    const clear = () => {
      window.clearTimeout(timer);
      open = null;
      setBubble(null);
    };

    /** The nearest ancestor carrying an explanation, or null. */
    const trigger = (target: EventTarget | null): HTMLElement | null =>
      target instanceof Element ? target.closest<HTMLElement>("[data-hint]") : null;

    function show(el: HTMLElement, delay: number) {
      const text = el.dataset.hint;
      if (!text || el === open) return;
      window.clearTimeout(timer);
      open = el;
      timer = window.setTimeout(() => setBubble(place(el, text)), delay);
    }

    const onOver = (e: Event) => {
      const el = trigger(e.target);
      if (el) show(el, OPEN_DELAY);
      else clear();
    };
    // Focus opens with no delay: someone tabbing here asked for it explicitly.
    const onFocus = (e: Event) => {
      const el = trigger(e.target);
      if (el) show(el, 0);
      else clear();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clear();
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", clear);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("keydown", onKey);
    // Capture phase: the drawer and both panes scroll independently, and a
    // bubble pinned to the window would otherwise drift away from its trigger.
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", clear);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
    };
  }, []);

  if (!bubble) return null;
  return (
    <div
      className={bubble.above ? "hint-bubble above" : "hint-bubble"}
      role="tooltip"
      aria-hidden="true"
      style={{ left: bubble.x, top: bubble.y }}
    >
      {bubble.text}
    </div>
  );
}
