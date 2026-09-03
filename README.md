<div align="center">

<img src="app/icons/scrivano-1024.png" width="104" alt="Scrivano">

# Scrivano

**Estrazione di dati dai moduli italiani, in locale.**

Take a photographed or scanned Italian form and get structured JSON out of it, on a laptop,
with no API key and no network. A 350M model fine-tuned for the job, and a desktop app that
runs it entirely offline.

![beta](https://img.shields.io/badge/release-beta-1d4ed8)
![macOS](https://img.shields.io/badge/macOS-supported-informational)
![Windows](https://img.shields.io/badge/Windows-supported-informational)
![licence](https://img.shields.io/badge/licence-CC%20BY--NC--SA%204.0-lightgrey)

</div>

---

## Introduction

*Lo scrivano* was the public writer who sat outside the town hall and filled in your forms for
you. This is that, as a 219 MiB file: you point it at a form, say which fields you want, and it
writes them out as JSON. Nothing leaves the machine.

The name is the whole scope. It does one thing — key information extraction from Italian
administrative forms — and it does it small enough to run on a laptop CPU.

Getting there meant solving three problems, and this repository holds all three:

1. **There is no Italian KIE dataset in the right shape.** XFUND has Italian form annotations,
   but as a graph of linked question and answer boxes, not as extraction targets.
   `local/make_kie.py` collapses that graph into a flat 35-key schema.
2. **A 350M model does not do this out of the box.** The base model scores 0.29 F1.
   Supervised fine-tuning on 149 documents takes it to 0.66 on the same benchmark.
3. **A model is not a product.** `app/` is the desktop workbench that makes it usable by
   someone who does not own a GPU or a terminal.

### Links

| | |
|---|---|
| Model | [`andreagemelli/LFM2.5-350M-IT-Extract`](https://huggingface.co/andreagemelli/LFM2.5-350M-IT-Extract) |
| GGUF, the one the app ships | [`andreagemelli/LFM2.5-350M-IT-Extract-GGUF`](https://huggingface.co/andreagemelli/LFM2.5-350M-IT-Extract-GGUF) (Q4_K_M, 219 MiB) |
| Dataset | [`andreagemelli/xfund-kie-it`](https://huggingface.co/datasets/andreagemelli/xfund-kie-it) |
| Base model | [`LiquidAI/LFM2.5-350M`](https://huggingface.co/LiquidAI/LFM2.5-350M) |
| Training notebook | [Colab](https://colab.research.google.com/drive/1j5Hk_SyBb2soUsuhU0eIEA9GwLNRnElF) |
| Source corpus | [XFUND](https://github.com/doc-analysis/XFUND), Italian split |
| Downloads | [Releases](../../releases/latest) — macOS `.dmg`, Windows `.exe` / `.msi` |
| Sample form | [`examples/dichiarazione-residenza.pdf`](examples/dichiarazione-residenza.pdf) |

---

## The application

![Scrivano with the sample residency form loaded: document on the left, the schema it is about to fill on the right](docs/screenshot-app.png)

The interface is in Italian, because so are the documents and so are the people filling them in.

**What it does**

- **Reads anything you drop on it** — `pdf png jpg jpeg webp tif tiff`. PDFs render page by page
  at 200 DPI. If a page's text layer yields more than 50 characters it is used directly and OCR
  is skipped, which is free and exact on born-digital forms.
- **OCRs the rest locally.** PP-OCRv5 detection plus the Latin recognition model, in Rust,
  through ONNX. Lines come back in detection order and are never sorted or deduplicated, because
  that is the order the model was trained on.
- **Lets you declare the fields.** A schema is a list of `key` + `description` rows. A new
  document starts with a 7-field preset (`nome`, `cognome`, `data-nascita`, `luogo-nascita`,
  `codice-fiscale`, `indirizzo`, `comune`) rather than all 35, because the model was fine-tuned
  on prompts averaging seven fields. Keys outside the training schema are allowed and marked
  *chiave non addestrata*.
- **Streams the answer.** Tokens appear as they are decoded, with the live decode rate in
  tokens per second next to the panel title.
- **Points values back at the page.** Hover a value in the JSON and every line containing it is
  outlined on the page image, and scrolled to.
- **Flags what it made up.** Every gold value in training was verbatim page text, so a returned
  value that appears nowhere on the page is marked *non nel documento*. Treat those as guesses.
- **Gives you the JSON.** Editable in place, per-value copy, copy all, download.
- **Remembers.** The last 50 documents stay in the rail, with their pages and their results.
- **Never phones home.** No Python, no Ollama, no network at runtime. The model and the OCR
  graphs are inside the installer.

**Decoding is configurable** from the settings drawer: temperature (0 by default, so a run is
deterministic), top-k, top-p, max tokens and seed.

> The schema editor is the part that matters. The published F1 was measured with the model told
> in advance which fields the document contains. No app can do that for a document it has not
> seen — *you* are the one supplying that knowledge. Scope the schema tightly and it does well;
> ask for thirty keys at once and precision drops, because the model will try to fill keys the
> document never contained.

The screenshot above is one real greedy run of the bundled Q4_K_M model over
[`examples/dichiarazione-residenza.pdf`](examples/dichiarazione-residenza.pdf) at 183 tok/s on an
M4. Five of the seven values are right. Two are not: `nome` is `ELISA` where the form says
`ELISA MARTA`, and `comune` is `LIVORNO (LI)`, which is the province printed beside the comune,
not the comune itself (`CASTELVERDE MARITTIMO`). Neither is flagged, because the flag only
catches values that appear nowhere on the page, and both of those strings are printed on it.
This is a 350M model: read the output, do not trust it.

---

## How to install

### The easy way

Go to [**Releases**](../../releases/latest) and take the file for your machine. The model is
already inside it: after installing, nothing else is downloaded and no network is needed.

**macOS** (Apple silicon) — download the `.dmg`, open it, drag **Scrivano** into Applications.

The build is not signed with an Apple Developer ID, so the first launch fails with
*"Scrivano is damaged and can't be opened"*. That is Gatekeeper quarantining an unsigned
download, not a broken file. Clear it once:

```bash
xattr -dr com.apple.quarantine "/Applications/Scrivano.app"
```

**Windows** (x64) — download the `.exe` (NSIS installer) or the `.msi` and run it.
SmartScreen will warn about an unknown publisher: *More info* → *Run anyway*. If the WebView2
runtime is missing the installer fetches it automatically.

Expect roughly 280 MB installed. First extraction on a document loads the model, so it is a
few seconds slower than the ones after it.

### From source

Needs Rust (stable), Node 22+, cmake, python3 and the Hugging Face CLI. Windows additionally
needs LLVM with `LIBCLANG_PATH` set, because `llama-cpp-sys-2` compiles llama.cpp from source.

```bash
cd app
npm install
./scripts/fetch-resources.sh      # LFM_GGUF=/path/to.gguf to use a local file
npm run tauri dev
```

`fetch-resources.sh` downloads the four bundled files into `src-tauri/resources/`, which is
gitignored. Run it once before the first build.

It has to be `npm run tauri dev`, not `npm run dev`: the latter starts only the Vite server, and
a page opened in a browser has no Tauri runtime, so opening files, OCR and the model are all
unavailable. The app says so in a banner if you end up there.

To build installers yourself:

```bash
npm run build                     # .dmg + .app, or .msi + .exe
npm run build -- --bundles app    # .app only, skips the dmg step
npm test                          # prompt contract self-check
```

The dmg step needs to drive Finder through AppleScript, so on a headless shell or one without
Automation permission it fails *after* the `.app` is already built. That is what `--bundles app`
is for.

### CI

`.github/workflows/release.yml` builds both platforms. Pushing a `v*` tag publishes a
prerelease with both installers attached and downloadable by anyone; a manual dispatch builds
both and attaches them as workflow artifacts instead, without creating a release.

---

## How it was built

### The dataset

[XFUND](https://github.com/doc-analysis/XFUND) Italian split. Each page is annotated as boxes
with a label (`question`, `answer`, `header`, `other`) plus a `linking` list joining questions
to answers.

| | train | val | total |
|---|---|---|---|
| documents | 149 | 50 | 199 |
| entities | 12,215 | 4,029 | 16,244 |
| `question` entities | 3,762 | 1,230 | 4,992 |
| `answer` entities | 4,932 | 1,599 | 6,531 |
| question to answer pairs | 4,927 | 1,597 | 6,524 |

`local/make_kie.py` turns each page into one flat `{key: value}` record. The hard part is that
the same field is written a dozen different ways across Italian public forms, so raw question
labels cannot be used as keys.

1. **Follow the links.** For each `question` entity, collect answers by following `linking`
   forward only. A question with no answer is dropped before anything else happens.
2. **Normalise the label.** Lowercase, strip accents, remove parenthesised asides (but only if
   something survives, because forms print field names as `(telefono)` under the box), drop
   leading numbering like `1)`, replace non-alphanumerics with spaces, collapse whitespace.
3. **Map to a canonical key.** 45 ordered regexes, first match wins, each anchored to match the
   whole label. Specific patterns come before generic ones, so `Luogo e data` is caught as the
   compound `luogo-data` before `luogo` or `data` can claim it.

   ```python
   ("codice-fiscale", r"(con |e )?(codice fiscale|cod(ice)? ?fisc?(ale)?|c ?f)( ?/ ?p(artita)? ?i ?v ?a)?")
   ("luogo-nascita",  r"(luogo|comune|citta) (di |o stato estero di )nascita|nat[oa/]{1,3}( a)?|a")
   ("nome-completo",  r"cognome ?[e/,]? ?nome|nominativo|(il|la|lo) sottoscritt[oa/]{1,3}|...")
   ```

   `telefono` and `cellulare` deliberately collapse into one key, as do `pec` and `email`. A
   label matching nothing is dropped.
4. **Clean the value.** Collapse whitespace, strip surrounding punctuation, unwrap a fully
   parenthesised value, drop an unbalanced bracket left over from form furniture like `(prov. FI)`.
5. **Reject non-values.** An answer containing a checkbox glyph (`□ ☒ ☐ × ✗ ✘`) has no single
   extractable value: 50 answers dropped. Two keys are type-checked against their own shape,
   `sesso` must be `M` or `F` and `cittadinanza` must look Italian: 54 more rejected, catching
   mislabelled boxes like `Cittadinanza: FIRENZE`.
6. **Split compounds.** `luogo-data` is searched for a date. Found, it emits `data` plus
   whatever text remains as `luogo`. Not found, the whole value becomes `luogo`.
7. **Handle repeated fields.** 99 questions link to more than one answer: a table column, a list
   of options. These cannot supply a single value, but they are not silently discarded either.
   Each answer is recorded with `usable=False` so it still counts as evidence that the field is
   not unique on that page.

A verification pass then asserts every emitted value is verbatim page text and every key is in
the schema. Nothing is paraphrased or synthesised.

| | train | val | combined |
|---|---|---|---|
| documents | 149 | 50 | 199 |
| annotated fields | 998 | 350 | 1,348 |
| fields per document (median) | 6 | 7 | 7 |
| fields per document (mean) | 6.70 | 7.00 | 6.77 |
| fields per document (max) | 17 | 15 | 17 |
| documents with no fields | 3 | 0 | 3 |

**The schema has 35 keys**, not 37 as `local/MODEL_CARD.md` states. Ordered by training
frequency: `luogo-nascita`, `comune`, `provincia`, `email`, `codice-fiscale`, `indirizzo`,
`data`, `nome`, `cognome`, `telefono`, `cap`, `nome-completo`, `data-nascita`, `nazione`,
`partita-iva`, `ragione-sociale`, `luogo`, `fax`, `sede-legale`, `data-rilascio`,
`rilasciato-da`, `tipo-documento`, `data-scadenza`, `banca`, `iban`, `cittadinanza`,
`protocollo`, `ruolo`, `professione`, `sesso`, `numero-civico`, `numero-documento`,
`intestatario`, `note`, `sito-web`. All 35 are used at least once; the most common are `comune`
(101), `luogo-nascita` (100) and `codice-fiscale` (94).

Each record carries the page text, the flat annotation, and grounding back to the source boxes:

```json
{
  "id": "it_val_0",
  "image": "it.val/it_val_0.jpg",
  "text": "ROMA\nDICHIARAZIONE DI RESIDENZA\nALLEGATO I\n...",
  "annotation": {
    "cognome": "VALLE",
    "nome": "LUISA",
    "data-nascita": "22/12/1977",
    "codice-fiscale": "VAL6647338477433",
    "data-rilascio": "2/12/2019"
  },
  "grounding": {
    "cognome": { "question": "1) Cognome*", "answer_id": 99 },
    "nome":    { "question": "Nome*",       "answer_id": 103 }
  }
}
```

`text` is every entity on the page joined by newlines **in annotation order**, including
`header` and `other` boxes. That ordering matters at inference time: it is the model's input
distribution, which is why the app feeds OCR lines in detection order rather than sorting them
spatially.

### The fine-tune

`local/data.py` renders each document into a three-turn conversation and pushes it to the Hub.
Two columns, `source` and `messages`, splits `train` (149) and `val` (50).

```
system:     Identify and extract information matching the following schema.
            Return data as a JSON object. Missing data should be omitted.

            codice-fiscale: the Italian tax identification code of a person or entity.
            nome: the first name or given name of a person.
            ...

user:       <raw page text>

assistant:  {"cognome": "VALLE", "nome": "LUISA", ...}
```

One `{key}: {description}.\n` line per field. The assistant turn is a JSON *string*, not a
nested object. `app/src/prompt.ts` rebuilds this byte for byte, and `npm test` is the contract
check that keeps the two in step. The field descriptions stay in English everywhere, including
in the Italian UI, because they are part of the prompt the model was trained on: translating
them would be a distribution shift, not a localisation.

Full fine-tune, not LoRA — there is no `adapter_config.json` and `model.safetensors` is the
complete 354,483,968-parameter weight set in bf16. TRL `SFTTrainer` on a single Colab GPU.
Hyperparameters, recovered from `training_args.bin` on the Hub:

| | |
|---|---|
| epochs | 3 (447 steps) |
| batch size | 1, no gradient accumulation |
| learning rate | 5e-5, linear schedule, 100 warmup steps |
| optimiser | `adamw_torch_fused`, weight decay 0.0, grad clip 1.0 |
| max sequence length | 1024, no packing |
| precision | fp32 with gradient checkpointing |
| loss | `chunked_nll` over the whole sequence (`assistant_only_loss=False`) |
| seed | 42 |

Eval loss went 2.2100 after epoch 1 to 1.9878 after epoch 2, token accuracy 0.6213. Roughly
400k tokens seen across the whole run.

### The architecture

LFM2 is a hybrid. From `layer_types`, the 16 blocks are:

```
conv conv attn | conv conv attn | conv conv attn | conv attn | conv attn | conv attn | conv
```

10 double-gated convolution blocks and 6 GQA attention blocks (16 heads, 8 KV heads). Hidden
size 1024, SwiGLU MLP at 6656, 65,536 vocab, tied embeddings, RoPE theta 1e6. Config says 128k
positions but the trained context is 32,768.

---

## Does the fine-tune actually work?

Yes, and by a wide margin. Measured on the 50-document Italian validation split, greedy decoding.

| Model | Avg F1 | JSON parse failures |
|---|---|---|
| `LiquidAI/LFM2.5-350M` (base) | 0.2877 | 6 / 50 |
| **`andreagemelli/LFM2.5-350M-IT-Extract`** | **0.6639** | 10 / 50 |
| same, Q4_K_M GGUF | 0.6635 | 10 / 50 |
| same, Q4_K_M on the app's own OCR text | 0.5662 | 10 / 50 |

**Fine-tuning more than doubles F1**, 0.29 → 0.66. That is the number that says a 350M model
can be taught Italian form extraction on 149 documents.

**Quantising to Q4_K_M is free.** It costs 0.0004 F1 and takes the model from 709 MiB to
219 MiB, which is why the small build is the one that ships. It decodes at roughly 143 tok/s on
an M4 — the app shows you the live rate, so you can check that on your own machine.

**The OCR stage costs about 0.10 F1.** Replacing gold page text with what PP-OCRv5 actually
reads drops 0.6635 to 0.5662: partly transcription error, partly a different line segmentation
than the XFUND entity order the model trained on.

Reproduce it:

```bash
uv sync
uv run main.py                                  # fine-tuned model, full val split
uv run main.py --model-id LiquidAI/LFM2.5-350M  # base model baseline
uv run main.py --limit 5 --debug                # per-document prompt, expected, got, tok/s
```

Requires Python 3.14 and [uv](https://docs.astral.sh/uv/). `main.py` pulls the pre-built prompts
from the Hub dataset and imports only `metric.evaluate`, so it needs nothing from `local/`. It
picks CUDA, then MPS, then CPU. On Apple silicon the model is loaded to CPU and then moved,
because loading straight onto MPS double-frees on torch 2.14.

### How to read those numbers honestly

*The schema is oracle-filtered.* `local/data.py` builds the system prompt from only those schema
keys present in the document's gold annotation, and `main.py` feeds that same stored prompt back
at evaluation time. The model is told in advance which fields exist, so it never has to decide
that 30 of 35 keys do not apply — which is the harder half of the task. **Every number above is
a ceiling, not an estimate.**

*Parse failures are excluded, not scored as zero.* A document whose output will not parse is
skipped rather than counted, so 0.6639 is a mean over 40 documents and 0.2877 a mean over 44:
different, self-selected subsets. Scoring failures as zero gives roughly 0.53 and 0.25 — still
a doubling, but from a lower base.

*A wrong value is counted twice.* `metric.py` increments both `fp` and `fn` on a mismatch, so a
document with every key present but every value wrong scores 0.0, not 0.5. Comparison is
case-insensitive and whitespace-stripped only, so `2/12/2019` and `02/12/2019` are a miss. The
average is macro over documents, so a 1-field page weighs as much as a 16-field one.

---

## The stack

Tauri 2.11, React 19, Vite 7, no UI kit and no CSS framework. Rust side is `llama-cpp-2` 0.1.156
(Metal on macOS, CPU on Windows) and `oar-ocr` 0.9.2 over ONNX Runtime 2.0.0-rc.13.

Bundled resources, fetched by `scripts/fetch-resources.sh` and gitignored:

| File | Size | Source |
|---|---|---|
| `det.onnx` | 4.6 MiB | `PaddlePaddle/PP-OCRv5_mobile_det_onnx` |
| `rec.onnx` | 7.7 MiB | `PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx` |
| `dict.txt` | 2.6 KiB | extracted from that repo's `inference.yml` |
| `model.gguf` | 219 MiB | `andreagemelli/LFM2.5-350M-IT-Extract-GGUF` |

---

## Shortcomings

This is a **beta**, and the honest list is longer than the feature list.

**It is a beta release.** The model is a first fine-tune, not a finished artefact. It can and
should get better in the very near future: more documents, `assistant_only_loss=True`, a
schema-noised prompt so the model learns to leave keys out, and a decoding constraint that
forces valid JSON would each move the number on their own. Treat the current weights as a
starting point that happens to be usable.

**149 documents is few, and it shows.** The fine-tune has certainly memorised properties of the
training set. The most visible symptom: **extraction is very sensitive to the schema
descriptions.** They are not decoration, they are part of the prompt the model was trained on.
Rewording `codice-fiscale: the Italian tax identification code of a person or entity` can change
what comes back. If a field extracts badly, edit its description before you blame the document —
and prefer the preset descriptions, which are the exact strings used in training.

**Only single-page extraction has been tested.** Every evaluation document is one page, and the
whole benchmark is one page per prompt. The app will happily concatenate all pages of a longer
document into one prompt, but nothing about that path has been measured, and a long document
fails with an explicit context-length error rather than being chunked.

**Only Italian has been tested.** The base model is multilingual and the recognition model is
the Latin one, so other Latin-script languages *should* be inherited from the base model rather
than broken — but "should" is doing real work in that sentence. No number in this README was
measured on anything but Italian. Non-Latin scripts need a different recognition model and are
out of scope.

**The published F1 is an upper bound**, for the three reasons in the section above: the oracle
schema, the excluded parse failures, and a metric that double-counts a wrong value.

**JSON is not guaranteed.** 10 of 50 validation outputs did not parse strictly. The app recovers
complete `"key": "value"` pairs from a truncated or unterminated object rather than showing you
nothing, but a 350M model with no grammar constraint sometimes runs past the schema, invents
keys and cycles until the token cap.

**Read what it returns.** Values not found verbatim on the page are flagged, but a value that
*is* printed on the page and simply belongs to a different field is not — the model can return
the province where the comune was asked for, and nothing will warn you.

**Operational limits.** macOS builds are unsigned (see the install section). History persists to
`history.json` capped at 50 documents, storing page images as base64 data URLs, so a few
multi-page scans will put hundreds of MB there.

---

## Licence

**CC BY-NC-SA 4.0** — see [`LICENSE`](LICENSE), with the full component breakdown in
[`NOTICE`](NOTICE).

This is inherited, not chosen. The fine-tune was trained on XFUND, which its authors release
under CC BY-NC-SA 4.0, so the derived dataset, the model and any build that bundles them are
adapted material under that licence: attribution, non-commercial, share-alike. The base model
`LiquidAI/LFM2.5-350M` carries the separate **LFM Open License v1.0** on top, which permits
commercial use only below $10M annual revenue and requires that notices travel with derivatives.
Both apply to the weights at once; the NonCommercial term is the stricter of the two, so it is
the one that governs.

The application source in `app/` would happily be MIT, but the thing people download is a single
installer with the model inside it, and that artefact is NC-SA. Retrain on data that is not
XFUND and the chain no longer binds.
