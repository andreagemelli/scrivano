<div align="center">

<img src="app/icons/scrivano-1024.png" width="104" alt="Scrivano">

# Scrivano

**Key information extraction from Italian forms, fully offline.**

Point it at a photographed or scanned Italian form, say which fields you want, and get
structured JSON out — on a laptop CPU, no API key, no network. A 350M model fine-tuned for
the job, bundled in a desktop app.

![beta](https://img.shields.io/badge/release-beta-1d4ed8)
![macOS](https://img.shields.io/badge/macOS-supported-informational)
![Windows](https://img.shields.io/badge/Windows-supported-informational)
![licence](https://img.shields.io/badge/licence-CC%20BY--NC--SA%204.0-lightgrey)

</div>

![Scrivano with the sample residency form loaded](docs/screenshot-app.png)

## Links

| | |
|---|---|
| Model | [`andreagemelli/LFM2.5-350M-IT-Extract`](https://huggingface.co/andreagemelli/LFM2.5-350M-IT-Extract) |
| GGUF (shipped in the app) | [`andreagemelli/LFM2.5-350M-IT-Extract-GGUF`](https://huggingface.co/andreagemelli/LFM2.5-350M-IT-Extract-GGUF) (Q4_K_M, 219 MiB) |
| Dataset | [`andreagemelli/xfund-kie-it`](https://huggingface.co/datasets/andreagemelli/xfund-kie-it) |
| Base model | [`LiquidAI/LFM2.5-350M`](https://huggingface.co/LiquidAI/LFM2.5-350M) |
| Downloads | [Releases](../../releases/latest) — macOS `.dmg`, Windows `.exe` / `.msi` |
| Sample form | [`examples/dichiarazione-residenza.pdf`](examples/dichiarazione-residenza.pdf) |

## Install

Grab the file for your machine from [**Releases**](../../releases/latest). The model is inside
it — nothing else downloads, no network needed. ~280 MB installed.

- **macOS** (Apple silicon) — open the `.dmg`, drag **Scrivano** into Applications. The build is
  unsigned, so first launch reports *"Scrivano is damaged"*. Clear the quarantine once:
  ```bash
  xattr -dr com.apple.quarantine "/Applications/Scrivano.app"
  ```
- **Windows** (x64) — run the `.exe` (NSIS) or `.msi`. SmartScreen: *More info* → *Run anyway*.

### From source

Needs Rust (stable), Node 22+, cmake, python3, the Hugging Face CLI (Windows also needs LLVM
with `LIBCLANG_PATH` set).

```bash
cd app
npm install
./scripts/fetch-resources.sh      # downloads the 4 bundled files; LFM_GGUF=/path to use a local gguf
npm run tauri dev                 # not `npm run dev` — that has no Tauri runtime
npm run build                     # installers; add `-- --bundles app` to skip the dmg step
npm test                          # prompt contract self-check
```

## How it works

- **Reads** `pdf png jpg jpeg webp tif tiff`. PDFs render at 200 DPI; a page's text layer is used
  directly when it yields >50 chars, else OCR (PP-OCRv5 + Latin recognition, Rust/ONNX).
- **You declare the fields** as `key` + `description` rows. New docs start with a 7-field preset,
  since the model was fine-tuned on prompts averaging seven fields. Keep the schema tight.
- **Streams the JSON**, points values back at the page on hover, and flags values that appear
  nowhere on the page as likely inventions.
- Decoding (temperature, top-k/p, max tokens, seed) is configurable; temperature 0 by default.

The published F1 assumes the model is told which fields the document contains — *you* supply that
by scoping the schema. This is a 350M model: read the output, don't trust it.

## Does the fine-tune work?

Measured on the 50-document Italian validation split, greedy decoding.

| Model | Avg F1 | JSON parse failures |
|---|---|---|
| `LiquidAI/LFM2.5-350M` (base) | 0.2877 | 6 / 50 |
| **`andreagemelli/LFM2.5-350M-IT-Extract`** | **0.6639** | 10 / 50 |
| same, Q4_K_M GGUF | 0.6635 | 10 / 50 |
| same, Q4_K_M on the app's own OCR text | 0.5662 | 10 / 50 |

Fine-tuning more than doubles F1 (0.29 → 0.66); quantising to Q4_K_M is essentially free; OCR
costs ~0.10 F1. These are **upper bounds**: the schema is oracle-filtered, parse failures are
excluded rather than scored zero, and the metric double-counts a wrong value.

Reproduce (Python 3.14 + [uv](https://docs.astral.sh/uv/)):

```bash
uv sync
uv run main.py                                  # fine-tuned model, full val split
uv run main.py --model-id LiquidAI/LFM2.5-350M  # base baseline
uv run main.py --limit 5 --debug                # per-doc prompt, expected, got, tok/s
```

How it was built — the dataset pipeline (`local/make_kie.py`), the fine-tune (`local/data.py`),
and the LFM2 architecture are documented in [`local/MODEL_CARD.md`](local/MODEL_CARD.md).

## Shortcomings

Beta. First fine-tune on 149 documents, so it's very sensitive to the schema descriptions (edit
those before blaming the document, and prefer the presets). Only single-page Italian extraction
is tested; JSON isn't guaranteed (10/50 outputs didn't parse strictly — the app recovers pairs
from truncated output); a right-looking value in the wrong field isn't flagged. macOS builds are
unsigned; history is capped at 50 docs storing pages as base64.

## Licence

**CC BY-NC-SA 4.0** — see [`LICENSE`](LICENSE), full breakdown in [`NOTICE`](NOTICE). Inherited
from XFUND (the training data) and stacked with the base model's LFM Open License v1.0; the
NonCommercial term governs. Retrain on non-XFUND data and the chain no longer binds.
