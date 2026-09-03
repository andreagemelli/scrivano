//! PP-OCRv5 detection + latin recognition through oar-ocr.

use anyhow::{anyhow, Result};
use oar_ocr::oarocr::{OAROCRBuilder, OAROCR};
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

#[derive(Debug, serde::Serialize)]
pub struct Line {
    pub text: String,
    #[serde(rename = "box")]
    pub bbox: Box,
}

// ponytail: one pipeline behind one mutex. Building it loads two ONNX graphs, and
// the UI only ever OCRs one page at a time, so a session pool would buy nothing.
static PIPELINE: OnceLock<Mutex<OAROCR>> = OnceLock::new();

fn pipeline(det: &Path, rec: &Path, dict: &Path) -> Result<&'static Mutex<OAROCR>> {
    if let Some(p) = PIPELINE.get() {
        return Ok(p);
    }
    let built = OAROCRBuilder::new(det, rec, dict).build()?;
    // A concurrent first call may have won the race; either pipeline is equivalent.
    let _ = PIPELINE.set(Mutex::new(built));
    Ok(PIPELINE.get().expect("just set"))
}

/// One Line per detected region, in detection order. Order is the model's
/// input order, so nothing here sorts, dedupes or merges. Regions without text
/// or without usable geometry are dropped.
pub fn run(det: &Path, rec: &Path, dict: &Path, png: &[u8]) -> Result<Vec<Line>> {
    let image = image::load_from_memory(png)?.to_rgb8();
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
            Some(Line {
                text,
                bbox: Box { x, y, w, h },
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

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
            eprintln!("{:?} {:?}", l.bbox, l.text);
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
