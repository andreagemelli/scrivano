//! Which language a page is in, by fastText's lid.176 language identifier
//! (176 languages, under a megabyte), narrowed to the eight the model knows.

use anyhow::Result;
use fasttext_pure_rs::FastText;
use std::path::Path;
use std::sync::OnceLock;

/// The `DocLang` codes in types.ts. lid.176 labels are `__label__<ISO 639-1>`,
/// and for these eight the codes are the same, so the map is the identity.
const LANGS: [&str; 8] = ["en", "it", "de", "es", "fr", "pt", "zh", "ja"];

/// Below this the folder's language stands. Measured on the 458 validation
/// pages of xfund-docai-xl, whole page, lowercased: nothing above it is wrong
/// except five English templates filled in with German, Spanish and Portuguese
/// values, which lid rightly calls English; three sparse memos fall below it.
const MIN_PROB: f32 = 0.5;

/// With fewer letters than this lid guesses anyway: "12/03/2024 00123 € 45,00"
/// comes back French at 0.56. Every validation page has at least ninety.
const MIN_LETTERS: usize = 20;

// Read-only once loaded, so no lock: concurrent calls just share it.
static MODEL: OnceLock<FastText> = OnceLock::new();

fn model(ftz: &Path) -> Result<&'static FastText> {
    if let Some(m) = MODEL.get() {
        return Ok(m);
    }
    let loaded = FastText::load(ftz)?;
    // A concurrent first call may have won the race; both models are the same file.
    Ok(MODEL.get_or_init(|| loaded))
}

/// A word that says something about the language. A token with no letter in it
/// says nothing, and an email or a web address says only where someone keeps an
/// account; both pulled OCR residue towards French. Measured neutral on the
/// validation pages: the same 450 right, 5 wrong, 3 left to the folder.
fn telling(token: &str) -> bool {
    token.chars().any(char::is_alphabetic)
        && !token.contains('@')
        && !token.contains("://")
        && !token.to_lowercase().starts_with("www.")
}

/// The page's language and how sure lid is of it, or None when it is unsure or
/// names a language outside the eight: the caller then keeps the folder's.
///
/// One prediction over the whole page, not a vote per line: voting was measured
/// worse (97.8% against 98.9%), mostly by losing Chinese pages to their short
/// Latin and digit lines. Lowercased, because all-caps forms read as noise —
/// the English FUNSD pages went from 82% to 100% on their first 200 characters.
pub fn detect(ftz: &Path, text: &str) -> Result<Option<(String, f32)>> {
    let text = text.split_whitespace().filter(|t| telling(t)).collect::<Vec<_>>().join(" ");
    if text.chars().filter(|c| c.is_alphabetic()).count() < MIN_LETTERS {
        return Ok(None);
    }
    // Twenty letters always make at least one token, so predict has input.
    let top = model(ftz)?.predict(&text.to_lowercase(), 1, 0.0)?.into_iter().next();
    Ok(top.and_then(|p| {
        let code = p.label.strip_prefix("__label__")?;
        (LANGS.contains(&code) && p.probability >= MIN_PROB)
            .then(|| (code.to_string(), p.probability))
    }))
}

#[cfg(test)]
mod tests {
    use super::detect;
    use std::path::PathBuf;

    /// Against the bundled model: all eight, a language outside them, and a page
    /// with too few letters to say anything about.
    #[test]
    fn detects_the_eight() {
        let ftz = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/lid.176.ftz");
        if !ftz.exists() {
            eprintln!("skipping: run scripts/fetch-resources.sh first");
            return;
        }
        let d = |t: &str| detect(&ftz, t).unwrap().map(|(c, _)| c);
        assert_eq!(d("Codice di comportamento per visitatori\noccasionali e consulenti").as_deref(), Some("it"));
        assert_eq!(d("SOLICITUD DE CANJE PARA HOSPEDAJE\nSeñores Banco del Pacífico").as_deref(), Some("es"));
        assert_eq!(d("Antrag auf Erteilung einer Aufenthaltserlaubnis\nName, Vorname, Geburtsdatum").as_deref(), Some("de"));
        assert_eq!(d("Déclaration de résidence\nNom, prénom et date de naissance du demandeur").as_deref(), Some("fr"));
        assert_eq!(d("Declaração de residência\nNome completo e data de nascimento do requerente").as_deref(), Some("pt"));
        assert_eq!(d("APPLICATION FOR EMPLOYMENT\nPlease print your full name and address").as_deref(), Some("en"));
        assert_eq!(d("請求書の支払期限は来月末です。ご確認をお願いいたします").as_deref(), Some("ja"));
        assert_eq!(d("申请人姓名和身份证号码，请填写完整的联系地址").as_deref(), Some("zh"));
        assert_eq!(d("Кто вы такой и откуда пришли, расскажите подробнее"), None, "outside the eight");
        assert_eq!(d("  \n "), None);
        assert_eq!(d("12/03/2024 00123 € 45,00"), None, "too few letters");
        // What the Latin OCR leaves of a Japanese form: it read as French.
        assert_eq!(d("-\n: 090-1111-2222\nE-mail : ichiro.suzuki@gmail.com\n:\n:"), None, "OCR residue");
    }
}
