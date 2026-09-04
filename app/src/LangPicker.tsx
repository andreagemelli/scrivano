import Menu from "./Menu";
import { DOC_LANGS } from "./catalog";
import type { DocLang } from "./types";

/**
 * Endonyms: a language picker that names languages in a language you cannot
 * read is a picker you cannot use.
 */
export const DOC_LANGUAGE_NAME: Record<DocLang, string> = {
  en: "English",
  it: "Italiano",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  pt: "Português",
  zh: "中文",
  ja: "日本語",
};

/**
 * Which language a document is written in — the eight the model was fine-tuned
 * on. The same control in two places, because the setting exists at two scopes:
 * a folder's, which decides what its documents start from, and one extraction's,
 * which overrides it for the odd page that does not match its folder.
 */
export default function LangPicker({
  lang,
  onLang,
  label,
  hint,
}: {
  lang: DocLang;
  onLang: (l: DocLang) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="doclang">
      <span className="muted">{label}</span>
      <Menu
        value={lang}
        choices={DOC_LANGS.map((l) => ({ value: l, label: DOC_LANGUAGE_NAME[l] }))}
        label={label}
        hint={hint}
        onChange={onLang}
      />
    </div>
  );
}
