# Scrivano — the app

Tauri 2 desktop app: OCR a document locally, then run the bundled fine-tuned LFM2 GGUF to fill
a schema you declare as key + description rows. Nothing leaves the machine.

For what it does, how to install a build, and what the model is worth, see the
[root README](../README.md). This file is the developer view.

## Prerequisites

- Rust (stable), Node 22+, python3
- cmake — `llama-cpp-2` builds llama.cpp from source
- the Hugging Face CLI — `pip install "huggingface_hub[cli]"`, used by the fetch script
- Windows only: LLVM, with `LIBCLANG_PATH` pointing at its `bin` directory, for bindgen

## Run it

```bash
npm install
./scripts/fetch-resources.sh    # LFM_GGUF=/path/to.gguf to use a local file
npm run tauri dev
```

`fetch-resources.sh` fills `src-tauri/resources/` (gitignored) with the four files the Rust side
expects. It is idempotent, so re-running it is a no-op.

It has to be `npm run tauri dev`. `npm run dev` starts only the Vite server, and a page opened in
a browser has no Tauri runtime, so opening files, OCR and the model are all unavailable. The app
says so in a banner if you end up there.

```bash
npm run build                    # installers under src-tauri/target/release/bundle/
npm run build -- --bundles app   # .app only, skips the dmg step
npm test                         # prompt contract self-check
cargo test --manifest-path src-tauri/Cargo.toml   # end-to-end decode + OCR, needs the resources
```

## Layout

| | |
|---|---|
| `src/prompt.ts` | The model contract. Mirrors `local/data.py` byte for byte. **Look here first** if extraction quality is wrong — it is the only place the prompt is built. |
| `src/prompt.test.ts` | The check that keeps `prompt.ts` and the training format in step. |
| `src/schema.json` | The 35 trained keys and their English descriptions. These are prompt text, not UI copy: they stay in English. |
| `src/pdf.ts` | Rendering, text-layer extraction, line merging, the OCR fallback. |
| `src/App.tsx` | Shell, document state, the extraction run and the tok/s measurement. |
| `src/Logo.tsx` | The mark. Same geometry as `icons/scrivano.svg`; edit both together. |
| `src-tauri/src/llm.rs` | llama.cpp decode loop and the sampler chain. |
| `src-tauri/src/ocr.rs` | PP-OCRv5 through `oar-ocr`, boxes normalised to 0..1. |

The UI is Italian. Field descriptions and the system prompt are not — they are what the model was
fine-tuned on.

## Icons

`icons/scrivano-1024.png` is the source: the mark on its tile, inset to Apple's 824/1024
proportions with a squircle alpha, so macOS and Windows both get clean edges.

```bash
npx tauri icon icons/scrivano-1024.png -o src-tauri/icons
rm -rf src-tauri/icons/android src-tauri/icons/ios    # this project ships desktop only
```

`src/logo.png` is the same mark cut out as an **alpha mask** — glyph only, no tile. The topbar
paints it with `background: var(--accent)` through a CSS mask rather than showing it as an image,
because the artwork is one blue that reads on a light tile and disappears on the dark theme's
surface. Regenerate it from the icon whenever the icon changes.

## Bundled resources

Fetched by the script, not committed:

| file | size | what |
| --- | --- | --- |
| `det.onnx` | 4.6 MiB | text detection |
| `rec.onnx` | 7.7 MiB | Latin text recognition |
| `dict.txt` | 2.6 KiB | recognition character set |
| `model.gguf` | 219 MiB | the extraction model, Q4_K_M |

The GGUF dominates the installer. Expect a bundle around 280 MB.
