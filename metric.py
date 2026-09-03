def normalize(text):
    return str(text).strip().lower()

def precision_recall_f1(tp, fp, fn):
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
    return precision, recall, f1

def evaluate(answer, annotations, debug=False):
    tp, fp, fn = 0, 0, 0
    for field, value in answer.items():
        if field not in annotations:
            fp += 1
            if debug:
                print(f"\nField '{field}' not found in annotations.")
            continue

        if normalize(value) != normalize(annotations[field]):
            fp += 1
            fn += 1
            if debug:
                print(f"\nMismatch for field '{field}':\n  Expected: {annotations[field]}\n  Got: {value}")
            continue

        tp += 1

    fn += len(annotations.keys() - answer.keys())
    precision, recall, f1 = precision_recall_f1(tp, fp, fn)
    if debug:
        print(f"\nPrecision: {precision:.2f}, Recall: {recall:.2f}, F1 Score: {f1:.2f}")
    return precision, recall, f1
