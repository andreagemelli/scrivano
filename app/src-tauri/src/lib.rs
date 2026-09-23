mod lid;
mod llm;
mod ocr;

use serde::Serialize;
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

const RESOURCES: [&str; 5] = ["det.onnx", "rec.onnx", "dict.txt", "model.gguf", "lid.176.ftz"];

/// Bundled resource, falling back to the repo copy so `tauri dev` works before
/// anything has been bundled.
fn res(app: &AppHandle, name: &str) -> PathBuf {
    let bundled = app
        .path()
        .resolve(format!("resources/{name}"), BaseDirectory::Resource);
    match bundled {
        Ok(p) if p.exists() => p,
        _ => PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(name),
    }
}

#[derive(Serialize)]
struct BackendStatus {
    ok: bool,
    detail: String,
}

#[tauri::command]
fn backend_status(app: AppHandle) -> BackendStatus {
    let missing: Vec<&str> = RESOURCES
        .into_iter()
        .filter(|f| !res(&app, f).exists())
        .collect();
    if missing.is_empty() {
        BackendStatus {
            ok: true,
            detail: format!("models in {}", res(&app, "model.gguf").display()),
        }
    } else {
        BackendStatus {
            ok: false,
            detail: format!(
                "Missing resources: {}. Run scripts/fetch-resources.sh",
                missing.join(", ")
            ),
        }
    }
}

#[tauri::command]
async fn ocr(app: AppHandle, png: Vec<u8>) -> Result<Vec<ocr::Line>, String> {
    let (det, rec, dict) = (
        res(&app, "det.onnx"),
        res(&app, "rec.onnx"),
        res(&app, "dict.txt"),
    );
    tauri::async_runtime::spawn_blocking(move || ocr::run(&det, &rec, &dict, &png))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Tokens go to this run's own channel, not to an app-wide event: two runs in
/// flight — an extraction and a classification asked for meanwhile — would
/// otherwise each hear the other's tokens. The model lock still runs them one
/// at a time; this only keeps their words apart.
#[tauri::command]
async fn extract(
    app: AppHandle,
    prompt: String,
    sampling: llm::Sampling,
    on_token: Channel<String>,
) -> Result<String, String> {
    let gguf = res(&app, "model.gguf");
    tauri::async_runtime::spawn_blocking(move || {
        llm::run(&gguf, &prompt, &sampling, |piece| {
            let _ = on_token.send(piece.to_owned());
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// The page's language and how sure of it, as `["it", 0.97]`, or null when the
/// folder's language should stand. Tens of microseconds, so no blocking pool.
#[tauri::command]
async fn detect_lang(app: AppHandle, text: String) -> Result<Option<(String, f32)>, String> {
    lid::detect(&res(&app, "lid.176.ftz"), &text).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![ocr, extract, detect_lang, backend_status])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, event| {
            // llama.cpp's Metal teardown aborts if the model outlives the process.
            if let tauri::RunEvent::Exit = event {
                llm::unload();
            }
        });
}
