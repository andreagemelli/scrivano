#!/usr/bin/env bash
# Fills src-tauri/resources/ with the five files the Rust backend expects.
# Idempotent: skips anything already present. Run once before "npm run tauri dev".
set -euo pipefail

RES="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/resources"
# Point LFM_GGUF at a local .gguf to skip the download.
GGUF_LOCAL="${LFM_GGUF:-}"
# The Windows runner has python.exe but not always python3 under git-bash.
PY="$(command -v python3 || command -v python)"
mkdir -p "$RES"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ ! -f "$RES/det.onnx" ]; then
  hf download PaddlePaddle/PP-OCRv5_mobile_det_onnx inference.onnx --local-dir "$TMP/det"
  mv "$TMP/det/inference.onnx" "$RES/det.onnx"
fi

if [ ! -f "$RES/rec.onnx" ] || [ ! -f "$RES/dict.txt" ]; then
  hf download PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx inference.onnx inference.yml --local-dir "$TMP/rec"
  mv "$TMP/rec/inference.onnx" "$RES/rec.onnx"
  # The dict ships only inside inference.yml, as a YAML list under PostProcess.character_dict.
  # One char per line, no blank and no trailing space entry: oar-ocr adds both itself.
  "$PY" - "$TMP/rec/inference.yml" "$RES/dict.txt" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
out, inside = [], False
for line in open(src, encoding="utf-8"):
    line = line.rstrip("\n")
    if line.strip() == "character_dict:":
        inside = True
        continue
    if not inside:
        continue
    if not line.startswith("  - "):
        break
    v = line[4:]
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        v = v[1:-1].replace(v[0] * 2, v[0])
    out.append(v)
assert len(out) > 100, f"only {len(out)} dict entries parsed"
assert all(len(c) == 1 for c in out), "every dict entry must be exactly one character"
open(dst, "w", encoding="utf-8").write("\n".join(out) + "\n")
print(f"dict.txt: {len(out)} characters")
PY
fi

if [ ! -f "$RES/model.gguf" ]; then
  if [ -n "$GGUF_LOCAL" ] && [ -f "$GGUF_LOCAL" ]; then
    cp "$GGUF_LOCAL" "$RES/model.gguf"
  else
    hf download andreagemelli/LFM2.5-350M-Extract-ML-LoRA-GGUF LFM2.5-350M-Extract-ML-LoRA-Q8_0.gguf --local-dir "$TMP/gguf"
    mv "$TMP/gguf/LFM2.5-350M-Extract-ML-LoRA-Q8_0.gguf" "$RES/model.gguf"
  fi
fi

# fastText's lid.176 language identifier, CC BY-SA 3.0 (see NOTICE). Pinned by
# hash: it is fetched from a plain URL, not a versioned repository.
LID_SHA256=8f3472cfe8738a7b6099e8e999c3cbfae0dcd15696aac7d7738a8039db603e83
if [ ! -f "$RES/lid.176.ftz" ]; then
  curl -fsSL -o "$TMP/lid.176.ftz" https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.ftz
  # $PY rather than sha256sum, which macOS does not have.
  "$PY" -c 'import hashlib,sys; h=hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest(); sys.exit(h!=sys.argv[2] and "lid.176.ftz: unexpected sha256 "+h)' "$TMP/lid.176.ftz" "$LID_SHA256"
  mv "$TMP/lid.176.ftz" "$RES/lid.176.ftz"
fi

# The attributions travel with the files they are owed for: resources/* is what
# the installer bundles, and CC BY-SA asks for the licence with every copy.
cp "$(dirname "$0")/../../NOTICE" "$RES/NOTICE"

ls -lh "$RES"
