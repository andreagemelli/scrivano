import { useEffect, useRef } from "react";
import { ArrowClockwise, ArrowsClockwise, Trash, Warning, X } from "@phosphor-icons/react";
import SchemaEditor from "./SchemaEditor";
import LangPicker from "./LangPicker";
import { defaultClasses } from "./catalog";
import { useT } from "./i18n";
import type { Field, Project } from "./types";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** True when the list is still exactly the twelve trained names, in order. */
function sameClasses(classes: Field[], trained: Record<string, string>): boolean {
  const names = Object.keys(trained);
  return classes.length === names.length && classes.every((c, i) => c.key === names[i]);
}

/**
 * One folder's settings: its name, and how documents opened into it get
 * classified.
 *
 * These used to live in the extraction settings, next to the schema and the
 * sampler. They do not belong there. The schema is what you want out of one
 * document and the sampler is how the model decodes; which classes exist is a
 * property of a BATCH of paperwork — a folder of invoices and a folder of
 * municipal forms want different lists, and one of them may want none at all.
 */
export default function ProjectPanel({
  project,
  trainedClasses,
  count,
  sweep,
  sweepBlocked,
  onReclassifyAll,
  canDelete,
  onChange,
  onDelete,
  onClose,
}: {
  project: Project;
  /** The twelve the model was fine-tuned on, for presets and the flag. */
  trainedClasses: Record<string, string>;
  /** How many documents are in here, so deleting says what it costs. */
  count: number;
  /** This folder being classified again, and how far along, or null. */
  sweep: { done: number; of: number } | null;
  /** Why the folder cannot be classified again right now, or "". */
  sweepBlocked: string;
  onReclassifyAll: () => void;
  /** The last project cannot go: there must always be somewhere to open into. */
  canDelete: boolean;
  onChange: (p: Project) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>(".drawer-close")?.focus();
  }, []);

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    // Bubble phase, not capture: a popover inside the panel stops Escape from
    // reaching here, so Escape closes the popover first and the panel second.
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const first = items[0];
      const last = items[items.length - 1];
      if (!active || !el.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const drifted = !sameClasses(project.classes, trainedClasses);

  return (
    <>
      <div className="scrim" onMouseDown={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={t.projectSettings} ref={panel}>
        <header className="drawer-head">
          <h2>{t.projectSettings}</h2>
          <span className="grow" />
          <button
            className="icon-btn drawer-close"
            aria-label={t.close}
            data-hint={t.close}
            onClick={onClose}
          >
            <X size={16} weight="regular" />
          </button>
        </header>

        <div className="drawer-body">
          <section className="group">
            <label className="named">
              <span className="setting-label">{t.projectName}</span>
              <input
                className="name-input"
                value={project.name}
                placeholder={t.firstProject}
                aria-label={t.projectName}
                onChange={(e) => onChange({ ...project, name: e.target.value })}
              />
            </label>
            {/* The folder's language, which is what makes it a folder and not
                just a label: it decides the class names below AND the schema a
                document opened in here starts from. */}
            <LangPicker
              lang={project.docLang}
              label={t.docLanguage}
              hint={t.projectLanguageHelp}
              onLang={(docLang) => onChange({ ...project, docLang })}
            />
            {/* On by default: the folder's language becomes the fallback for a
                page detection cannot place, rather than a rule for every page. */}
            <label className="toggle" data-hint={t.detectLangHelp}>
              <input
                type="checkbox"
                checked={project.detectLang}
                onChange={(e) => onChange({ ...project, detectLang: e.target.checked })}
              />
              {t.detectLang}
            </label>
            <p className="setting-help">{t.projectHelp(count)}</p>
          </section>

          <SchemaEditor
            fields={project.classes}
            known={trainedClasses}
            kind="class"
            head={
              <>
                {/* The off switch for this folder only. The list stays editable
                    with it off: turning it back on should not mean rebuilding
                    what you had. */}
                <label className="toggle" data-hint={t.classifyHelp}>
                  <input
                    type="checkbox"
                    checked={project.classify}
                    onChange={(e) => onChange({ ...project, classify: e.target.checked })}
                  />
                  {t.classifyOnOpen}
                </label>
                <button
                  className="icon-btn"
                  aria-label={t.restoreClasses}
                  data-hint={t.restoreClasses}
                  onClick={() => onChange({ ...project, classes: defaultClasses(project.docLang) })}
                >
                  <ArrowClockwise size={15} weight="regular" />
                </button>
              </>
            }
            onChange={(classes) => onChange({ ...project, classes })}
          />

          {/* Editing or extending the list is allowed and sometimes right, but
              the model was fine-tuned on exactly twelve names. Said whenever the
              list differs: it is used on open, and by hand even with that off. */}
          {drifted && (
            <p className="warn-note">
              <Warning size={14} weight="regular" />
              {t.classesChanged}
            </p>
          )}
          {!project.classify && <p className="hint">{t.classifyOff}</p>}

          {/* The list above only decides documents classified from now on. The
              ones already in here keep the class they got, even one no longer
              on the list, until they are asked again. */}
          <section className="group sweep">
            <button
              className="btn"
              aria-disabled={sweepBlocked !== "" || undefined}
              aria-describedby="sweep-help"
              onClick={() => sweepBlocked === "" && onReclassifyAll()}
            >
              <ArrowsClockwise size={14} weight="regular" />
              {sweep ? t.classifyingAll(sweep.done + 1, sweep.of) : t.classifyAll(count)}
            </button>
            {/* Why it cannot run, when it cannot, in the text itself: a hint
                bubble is invisible to a screen reader. */}
            <p className="setting-help" id="sweep-help">
              {sweepBlocked || t.classifyAllHelp}
            </p>
          </section>
        </div>

        {canDelete && (
          <footer className="drawer-foot">
            {/* Says what it costs before you press it: the documents outlive the
                folder, they move to the first one. */}
            <button className="btn danger" data-hint={t.deleteProjectHelp(count)} onClick={onDelete}>
              <Trash size={14} weight="regular" />
              {t.deleteProject}
            </button>
          </footer>
        )}
      </div>
    </>
  );
}
