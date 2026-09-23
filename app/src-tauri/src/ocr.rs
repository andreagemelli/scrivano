//! PP-OCRv5 detection + latin recognition through oar-ocr.

use anyhow::{anyhow, Result};
use oar_ocr::oarocr::{OAROCRBuilder, OAROCR};
use oar_ocr::processors::BoundingBox;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

/// Axis-aligned rect, normalised 0..1 against the page image so the UI never
/// needs the pixel size.
#[derive(Debug, serde::Serialize)]
pub struct Box {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// Where one word of a line sits across the page: from UTF-16 offset `at` of
/// the line's text, drawn between `x` and `x + w`, normalised 0..1. Mirrors
/// `Run` in types.ts, which is why the offset counts UTF-16 units and not chars.
#[derive(Debug, serde::Serialize)]
pub struct Run {
    pub at: usize,
    pub x: f32,
    pub w: f32,
}

#[derive(Debug, serde::Serialize)]
pub struct Line {
    pub text: String,
    #[serde(rename = "box")]
    pub bbox: Box,
    /// Empty when the recognizer's positions could not be trusted. The UI then
    /// hides a value on this line by blacking out the whole line.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub runs: Vec<Run>,
}

// ponytail: one pipeline behind one mutex. Building it loads two ONNX graphs, and
// the UI only ever OCRs one page at a time, so a session pool would buy nothing.
static PIPELINE: OnceLock<Mutex<OAROCR>> = OnceLock::new();

fn pipeline(det: &Path, rec: &Path, dict: &Path) -> Result<&'static Mutex<OAROCR>> {
    if let Some(p) = PIPELINE.get() {
        return Ok(p);
    }
    // Per-character boxes, from the CTC columns the recognizer already
    // computes: measured at no cost in speed and no change in the text.
    let built = OAROCRBuilder::new(det, rec, dict)
        .return_word_box(true)
        .build()?;
    // A concurrent first call may have won the race; either pipeline is equivalent.
    let _ = PIPELINE.set(Mutex::new(built));
    Ok(PIPELINE.get().expect("just set"))
}

/// One Line per detected region, in detection order. Order is the model's
/// input order, so nothing here sorts, dedupes or merges. Regions without text
/// or without usable geometry are dropped.
pub fn run(det: &Path, rec: &Path, dict: &Path, png: &[u8]) -> Result<Vec<Line>> {
    let image = upright(png)?;
    let (iw, ih) = (image.width() as f32, image.height() as f32);
    if iw <= 0.0 || ih <= 0.0 {
        return Err(anyhow!("l'immagine della pagina ha dimensione zero"));
    }
    let cell = pipeline(det, rec, dict)?;
    let ocr = cell.lock().map_err(|e| anyhow!("pipeline OCR corrotta: {e}"))?;
    let result = ocr
        .predict(vec![image])?
        .pop()
        .ok_or_else(|| anyhow!("l'OCR non ha restituito risultati per la pagina"))?;
    Ok(result
        .text_regions
        .into_iter()
        .filter_map(|r| {
            let text = r.text?.to_string();
            // Detection polygon, in the input image's pixel coordinates.
            let poly = r.bounding_box;
            if poly.points.is_empty() {
                return None;
            }
            let x = (poly.x_min() / iw).clamp(0.0, 1.0);
            let y = (poly.y_min() / ih).clamp(0.0, 1.0);
            let w = (poly.x_max() / iw).clamp(0.0, 1.0) - x;
            let h = (poly.y_max() / ih).clamp(0.0, 1.0) - y;
            if w <= 0.0 || h <= 0.0 {
                return None;
            }
            let runs = chars(&text, r.word_boxes.as_deref().unwrap_or(&[]), &poly, iw);
            Some(Line {
                text,
                bbox: Box { x, y, w, h },
                runs,
            })
        })
        .collect())
}

/// The page as the webview draws it. A phone photo keeps its pixels sideways
/// and says how to turn them in EXIF, which the webview honours; OCR on the raw
/// pixels would place every box a quarter turn away from the text on screen,
/// and a box meant to black out a name would cover blank paper.
fn upright(bytes: &[u8]) -> Result<image::RgbImage> {
    use image::ImageDecoder;
    let mut decoder = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()?
        .into_decoder()?;
    let orientation = decoder.orientation()?;
    let mut img = image::DynamicImage::from_decoder(decoder)?;
    img.apply_orientation(orientation);
    Ok(img.to_rgb8())
}

/// One run per character, from the recognizer's box for each (`chars`, pixels)
/// on the `line` it read them from.
///
/// Characters, not words: a value glued to its label ("Nome:ROSSI") starts
/// inside a word, and spreading that word evenly was measured to leave a
/// letter uncovered. The guards are the part that matters, and each one means
/// no runs, so the whole line is blacked out instead:
/// - one box per character, or the boxes are not about this text;
/// - a box starting past the end of the line means CTC emitted into the
///   batch's padding, which was only ever seen on lines it had also misread;
/// - a line standing on end (a margin stamp, a page scanned sideways) is turned
///   upright to be read, but its boxes are still laid across its width, so
///   they would place a value beside its glyphs.
fn chars(text: &str, chars: &[BoundingBox], line: &BoundingBox, iw: f32) -> Vec<Run> {
    let n = text.chars().count();
    let x_end = line.x_max();
    let across = line.x_max() - line.x_min() > line.y_max() - line.y_min();
    if n == 0 || !across || chars.len() != n || chars.iter().any(|c| c.x_min() >= x_end) {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut utf16 = 0;
    for (c, b) in text.chars().zip(chars) {
        if !c.is_whitespace() {
            let x0 = b.x_min();
            out.push(Run {
                at: utf16,
                x: (x0 / iw).clamp(0.0, 1.0),
                w: ((b.x_max().min(x_end) - x0) / iw).max(0.0),
            });
        }
        utf16 += c.len_utf16();
    }
    out
}

#[cfg(test)]
mod tests {
    use oar_ocr::processors::BoundingBox;
    use std::path::PathBuf;

    /// A line ten pixels tall ending at `x_end`.
    fn line(x_end: f32) -> BoundingBox {
        BoundingBox::from_coords(0.0, 0.0, x_end, 10.0)
    }

    /// Ten pixels per character on a 100 px page, so a run reads off in tenths.
    fn boxes(n: usize) -> Vec<BoundingBox> {
        (0..n)
            .map(|i| BoundingBox::from_coords(i as f32 * 10.0, 0.0, i as f32 * 10.0 + 10.0, 10.0))
            .collect()
    }

    #[test]
    fn one_run_per_character() {
        let runs = super::chars("Nome  MARIO", &boxes(11), &line(110.0), 100.0);
        let got: Vec<(usize, f32, f32)> = runs.iter().map(|r| (r.at, r.x, r.w)).collect();
        // Spaces take no run; everything else takes its own box.
        assert_eq!(got.iter().map(|g| g.0).collect::<Vec<_>>(), vec![0, 1, 2, 3, 6, 7, 8, 9, 10]);
        assert!((got[4].1 - 0.6).abs() < 1e-6 && (got[4].2 - 0.1).abs() < 1e-6, "{got:?}");
    }

    #[test]
    fn offsets_are_utf16() {
        // An astral character is one char and two UTF-16 units: JS indexes by the latter.
        let runs = super::chars("\u{1F600} ok", &boxes(4), &line(40.0), 100.0);
        assert_eq!(runs.iter().map(|r| r.at).collect::<Vec<_>>(), vec![0, 3, 4]);
    }

    #[test]
    fn untrusted_boxes_give_no_runs() {
        assert!(super::chars("abc", &boxes(2), &line(30.0), 100.0).is_empty(), "count mismatch");
        assert!(super::chars("abc", &boxes(3), &line(15.0), 100.0).is_empty(), "past the line end");
        assert!(super::chars("", &[], &line(0.0), 100.0).is_empty());
        // Standing on end: the boxes are laid across a width the text does not run along.
        let tall = BoundingBox::from_coords(0.0, 0.0, 30.0, 90.0);
        assert!(super::chars("abc", &boxes(3), &tall, 100.0).is_empty(), "vertical line");
    }

    /// A photo stored sideways with an EXIF turn comes out the way it is shown:
    /// wide pixels, turned a quarter, are tall.
    #[test]
    fn honours_exif_orientation() {
        use image::ImageEncoder;
        let wide = image::RgbImage::from_pixel(40, 20, image::Rgb([255, 255, 255]));
        let mut jpeg = Vec::new();
        let mut enc = image::codecs::jpeg::JpegEncoder::new(&mut jpeg);
        enc.set_exif_metadata(exif_orientation(6)).expect("exif");
        enc.encode_image(&wide).expect("encode");
        let img = super::upright(&jpeg).expect("decode");
        assert_eq!((img.width(), img.height()), (20, 40));
    }

    /// A minimal little-endian TIFF block carrying one tag: Orientation.
    fn exif_orientation(o: u16) -> Vec<u8> {
        let mut v = b"II*\0\x08\0\0\0\x01\0".to_vec();
        v.extend_from_slice(&[0x12, 0x01, 3, 0, 1, 0, 0, 0]);
        v.extend_from_slice(&o.to_le_bytes());
        v.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
        v
    }

    /// Loads the real models and runs one page. Proves the dict format and the
    /// ONNX wiring, which are the parts that fail silently. Set OCR_TEST_PNG to
    /// a page image to also eyeball the recognised lines.
    #[test]
    fn pipeline_runs() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        if !dir.join("det.onnx").exists() {
            eprintln!("skipping: run scripts/fetch-resources.sh first");
            return;
        }
        let png = match std::env::var("OCR_TEST_PNG") {
            Ok(p) => std::fs::read(p).unwrap(),
            Err(_) => {
                let blank = image::RgbImage::from_pixel(640, 480, image::Rgb([255, 255, 255]));
                let mut buf = std::io::Cursor::new(Vec::new());
                blank
                    .write_to(&mut buf, image::ImageFormat::Png)
                    .expect("encode blank page");
                buf.into_inner()
            }
        };
        let lines = super::run(
            &dir.join("det.onnx"),
            &dir.join("rec.onnx"),
            &dir.join("dict.txt"),
            &png,
        )
        .expect("OCR pipeline");
        for l in &lines {
            eprintln!("{:?} {:?} {:?}", l.bbox, l.text, l.runs);
        }
        for l in &lines {
            let b = &l.bbox;
            assert!(b.x >= 0.0 && b.y >= 0.0, "box outside image: {b:?}");
            assert!(b.x + b.w <= 1.0 && b.y + b.h <= 1.0, "box outside image: {b:?}");
            assert!(b.w > 0.0 && b.h > 0.0, "degenerate box: {b:?}");
        }
        // A real page gives many lines with distinct geometry; a blank one gives none.
        if std::env::var("OCR_TEST_PNG").is_ok() {
            assert!(lines.len() > 1, "expected several lines from the test page");
            let first = &lines[0].bbox;
            assert!(
                lines
                    .iter()
                    .any(|l| l.bbox.x != first.x || l.bbox.y != first.y),
                "all boxes identical"
            );
        }
    }
}
