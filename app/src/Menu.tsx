import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

/**
 * A dropdown in the app's own language instead of the platform's.
 *
 * The two native `<select>`s this replaces were the only controls in the app the
 * OS drew for itself, and they looked it — a grey macOS popup sitting between a
 * segmented control and a set of soft-cornered buttons. This is the popover the
 * schema presets already use (`.popwrap` / `.popover` / `.poplist`), so it is
 * the same object the app opens everywhere else, not a third menu idiom.
 */
export type Choice<T extends string> = { value: T; label: string; note?: string };

export default function Menu<T extends string>({
  value,
  choices,
  onChange,
  label,
  hint,
  icon,
  align = "left",
  disabled,
}: {
  value: T;
  choices: Choice<T>[];
  onChange: (v: T) => void;
  /** Read by screen readers; the button itself shows the current choice. */
  label: string;
  hint?: string;
  /** Given, the trigger is this icon alone: the menu is the label. */
  icon?: ReactNode;
  align?: "left" | "right";
  /** Why it cannot open right now. Shown as its hint; absent means it can. */
  disabled?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  // Inside a scrolling list — the rail — a menu on the last row opens below
  // the fold. The popover already counts toward that list's scroll height, so
  // bringing it into view is all it takes.
  useEffect(() => {
    if (open) pop.current?.scrollIntoView({ block: "nearest" });
  }, [open]);
  const current = choices.find((c) => c.value === value);

  // A click anywhere else closes it. Blur alone is not enough: WebKit does not
  // focus a button on mousedown, so pressing one outside the menu never moves
  // focus and never fires the wrapper's blur.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div
      className={align === "right" ? "menu popwrap right" : "menu popwrap"}
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        className={icon ? "icon-btn" : "menu-btn"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={disabled || label}
        aria-disabled={disabled ? true : undefined}
        data-hint={disabled || hint}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        {icon ?? (
          <>
            <span className="menu-value">{current?.label ?? value}</span>
            <CaretDown size={12} weight="regular" />
          </>
        )}
      </button>
      {open && (
        <div className="popover" role="listbox" aria-label={label} ref={pop}>
          <div className="poplist">
            {choices.map((c) => (
              <button
                key={c.value}
                role="option"
                aria-selected={c.value === value}
                // Same reason as the presets popover: letting the press move
                // focus would tear the menu down before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(c.value);
                  setOpen(false);
                }}
              >
                <span>{c.label}</span>
                {c.note !== undefined && <span className="muted">{c.note}</span>}
                {c.value === value && <Check size={13} weight="bold" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
