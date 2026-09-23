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

`fetch-resources.sh` fills `src-tauri/resources/` (gitignored) with the five files the Rust side
expects. It is idempotent, so re-running it is a no-op.

It has to be `npm run tauri dev`. `npm run dev` starts only the Vite server, and a page opened in
a browser has no Tauri runtime, so opening files, OCR and the model are all unavailable. The app
says so in a banner if you end up there.

```bash
npm run build                    # installers under src-tauri/target/release/bundle/
npm run build -- --bundles app   # .app only, skips the dmg step
npm test                         # prompt contract + redaction self-checks
cargo test --manifest-path src-tauri/Cargo.toml   # end-to-end decode + OCR, needs the resources
```

## Layout

| | |
|---|---|
| `src/prompt.ts` | The model contract. Mirrors `local/make_docai.py` byte for byte. **Look here first** if extraction or classification quality is wrong — it is the only place a prompt is built. |
| `src/prompt.test.ts` | The check that keeps `prompt.ts` and the training format in step. |
| `src/schemas.json` | Every trained key per language, key → description, both written in the document's own language. Lifted verbatim from `local/xfund-docai-xl`. Prompt text, not UI copy. |
| `src/classes.json` | The twelve document classes, each with a name and a description per language. Same provenance, same rule. |
| `src/catalog.ts` | What the two files above mean: the seven-key presets per language, the class list, and the table that resolves a class the model named in another language. |
| `src/i18n.ts` | Every word of UI, in both interface languages. English is the source of truth; Italian is typed against it. |
| `src/LangPicker.tsx` | The eight document languages, named in themselves. One control at two scopes: a folder's default, and one extraction's override. |
| `src/ProjectPanel.tsx` | One folder's settings: its name, the language its documents are in, and how they get classified. Classification is a property of a batch, not of the model or of one document, which is why it is not in the extraction settings. |
| `src/Menu.tsx` | The app's own dropdown, over the same popover the schema presets use. Replaced the two native `<select>`s, which were the only controls the OS drew for itself. |
| `src/Hints.tsx` | Tooltips. WKWebView draws no `title`, so every explanation in the app was invisible in the shipped build until this existed. |
| `src/pdf.ts` | Rendering, text-layer extraction, line merging, the OCR fallback. |
| `src/redact.ts` | Hiding a value: finding it on the page, masking it in the text and the JSON, placing its box on the image, and writing the PDF by hand from the painted page images. |
| `src/redact.test.ts` | The check that keeps a hidden value hidden, including the PDF's byte offsets. |
| `src/App.tsx` | Shell, document state, the extraction run and the tok/s measurement. |
| `src/Logo.tsx` | The mark. Same geometry as `icons/scrivano.svg`; edit both together. |
| `src-tauri/src/llm.rs` | llama.cpp decode loop and the sampler chain. |
| `src-tauri/src/ocr.rs` | PP-OCRv5 through `oar-ocr`, boxes normalised to 0..1, one run per character from the recognizer's CTC columns. |
| `src-tauri/src/lid.rs` | The page's language, by fastText's `lid.176` through the pure-Rust `fasttext-pure-rs`, narrowed to the eight and to answers it is at least even sure of. |
| `scripts/ui-shots.mjs` | Screenshots of every UI state in WebKit, by faking `window.__TAURI_INTERNALS__`. Needs `npm i -D --no-save playwright`; not part of `npm test`. |

The UI is English or Italian. Field descriptions and class names are written in the document's
language, and the system prompt in English — that is what the model was fine-tuned on.

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
| `model.gguf` | 362 MiB | the extraction model, Q8_0 |
| `lid.176.ftz` | 917 KiB | fastText language identification, pinned by sha256 |

The GGUF dominates the installer. Expect a bundle around 420 MB.
