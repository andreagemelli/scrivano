import time
import json
import argparse
import torch

from tqdm import tqdm
from transformers import AutoModelForCausalLM, AutoTokenizer
from datasets import load_dataset

from metric import evaluate

BASE_MODEL = "LiquidAI/LFM2.5-350M"
TUNED_MODEL = "andreagemelli/LFM2.5-350M-Extract-ML-LoRA"


def run_eval(model_id=TUNED_MODEL, limit=None, max_new_tokens=1024, debug=False, gguf_file=None):
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    # load on CPU first, then move: loading straight onto mps double-frees (torch 2.14 / M-series)
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        dtype="bfloat16",
        gguf_file=gguf_file,
    ).to(device)
    # GGUF repos ship no tokenizer transformers can map for lfm2: take it from the unquantized sibling
    tokenizer = AutoTokenizer.from_pretrained(model_id.removesuffix("-GGUF") if gguf_file else model_id)
    documents = load_dataset("andreagemelli/xfund-docai-xl", split="val")
    if limit:
        documents = documents.select(range(min(limit, len(documents))))

    languages = {}
    tasks = {}

    for document in tqdm(documents, desc="Evaluating"):
        prompt = [msg for msg in document["messages"] if msg["role"] != "assistant"]

        inputs = tokenizer.apply_chat_template(
            prompt,
            add_generation_prompt=True,
            return_tensors="pt",
            tokenize=True,
            return_dict=True,
        ).to(model.device)
        prompt_len = inputs["input_ids"].shape[1]

        if debug:
            print(f"\nDocument ID: {document['document_id']}")
            print("\n===Prompt===\n", tokenizer.decode(inputs["input_ids"][0], skip_special_tokens=True))

        start = time.time()
        output = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
        )
        end = time.time()

        answer = tokenizer.decode(output[0, prompt_len:], skip_special_tokens=True).strip()
        # the dataset stores the assistant turn as a JSON string, not a dict
        annotations = json.loads(
            [msg["content"] for msg in document["messages"] if msg["role"] == "assistant"][0]
        )

        if debug:
            new_tokens = output.shape[1] - prompt_len
            print(f"\nTime taken: {end - start:.2f} seconds | Tok/s: {new_tokens / (end - start):.2f}")
            print("\n===Expected===\n", annotations)
            print("\n===Got===\n", answer)

        try:
            _, _, f1 = evaluate(json.loads(answer), annotations, debug=debug)

            languages[document["lang"]] = languages.get(document["lang"], {'f1': [], 'errors': 0})
            languages[document["lang"]]['f1'].append(f1)
            tasks[document["task"]] = tasks.get(document["task"], {'f1': [], 'errors': 0})
            tasks[document["task"]]['f1'].append(f1)

        except json.JSONDecodeError as e:
            if debug:
                print("\n===Error===\n", e)
            languages[document["lang"]] = languages.get(document["lang"], {'f1': [], 'errors': 0})
            languages[document["lang"]]['errors'] += 1
            tasks[document["task"]] = tasks.get(document["task"], {'f1': [], 'errors': 0})
            tasks[document["task"]]['errors'] += 1

    print("\n===Per Language F1 Scores===")
    for lang, metrics in languages.items():
        avg_f1 = sum(metrics['f1']) / (len(metrics['f1']) + metrics['errors']) if metrics['f1'] else 0
        print(f"{lang}: Average F1 Score: {avg_f1:.4f}, Errors: {metrics['errors']} / {len(metrics['f1']) + metrics['errors']}")

    print("\n===Per Task F1 Scores===")
    for task, metrics in tasks.items():
        avg_f1 = sum(metrics['f1']) / (len(metrics['f1']) + metrics['errors']) if metrics['f1'] else 0
        print(f"{task}: Average F1 Score: {avg_f1:.4f}, Errors: {metrics['errors']} / {len(metrics['f1']) + metrics['errors']}")

    val_f1 = [f1 for metrics in languages.values() for f1 in metrics['f1']]
    errors = sum(metrics['errors'] for metrics in languages.values())
    print(f"\nAverage F1 Score: {sum(val_f1) / len(documents) if val_f1 else 0:.4f}")
    print(f"Total Errors: {errors} out of {len(documents)} documents.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate a model on the xfund-docai-xl val split.")
    parser.add_argument("--model-id", default=TUNED_MODEL, help=f"default: {TUNED_MODEL}; base is {BASE_MODEL}")
    parser.add_argument("--limit", type=int, help="only evaluate the first N documents")
    parser.add_argument("--max-new-tokens", type=int, default=1024)
    parser.add_argument("--gguf-file", help="filename of the .gguf quant to load from a GGUF repo, e.g. model-Q8_0.gguf")
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    print(f"Evaluation args: model_id={args.model_id}, gguf_file={args.gguf_file}, limit={args.limit}, max_new_tokens={args.max_new_tokens}, debug={args.debug}")
    run_eval(args.model_id, args.limit, args.max_new_tokens, args.debug, args.gguf_file)
