import time
import json
import argparse
import torch

from tqdm import tqdm
from transformers import AutoModelForCausalLM, AutoTokenizer
from datasets import load_dataset

from metric import evaluate

BASE_MODEL = "LiquidAI/LFM2.5-350M"
TUNED_MODEL = "andreagemelli/LFM2.5-350M-IT-Extract"


def run_eval(model_id=TUNED_MODEL, limit=None, max_new_tokens=1024, debug=False):
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    # load on CPU first, then move: loading straight onto mps double-frees (torch 2.14 / M-series)
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        dtype="bfloat16",
    ).to(device)
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    documents = load_dataset("andreagemelli/xfund-kie-it", split="val")
    if limit:
        documents = documents.select(range(min(limit, len(documents))))
    val_f1 = []
    errors = 0

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
            print(f"\nDocument ID: {document['source']}")
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
            val_f1.append(f1)

        except json.JSONDecodeError as e:
            if debug:
                print("\n===Error===\n", e)
            errors += 1

    print(f"\nAverage F1 Score: {sum(val_f1) / len(documents) if val_f1 else 0:.4f}")
    print(f"Total Errors: {errors} out of {len(documents)} documents.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate a model on the xfund-kie-it val split.")
    parser.add_argument("--model-id", default=TUNED_MODEL, help=f"default: {TUNED_MODEL}; base is {BASE_MODEL}")
    parser.add_argument("--limit", type=int, help="only evaluate the first N documents")
    parser.add_argument("--max-new-tokens", type=int, default=1024)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    print(f"Evaluation args: model_id={args.model_id}, limit={args.limit}, max_new_tokens={args.max_new_tokens}, debug={args.debug}")
    run_eval(args.model_id, args.limit, args.max_new_tokens, args.debug)
