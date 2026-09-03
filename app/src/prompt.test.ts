/** npm test. Guards the model contract: if this fails, extraction quality is next. */
import { buildSystem, buildPrompt, parseAnswer, isGrounded } from "./prompt";
import schema from "./schema.json";

/** No framework and no @types/node: one comparison is the whole harness. */
function eq(got: unknown, want: unknown, what = "") {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) throw new Error(`${what}\n  got  ${g}\n  want ${w}`);
}

const HEADER =
  "Identify and extract information matching the following schema.\n" +
  "Return data as a JSON object. Missing data should be omitted.\n\n";

// Captured from andreagemelli/xfund-kie-it, val row it_val_0, first two schema rows.
const fields = [
  { key: "luogo-nascita", description: schema["luogo-nascita"] },
  { key: "comune", description: schema.comune },
];
const GOLDEN =
  HEADER +
  "luogo-nascita: the place (city, town, or municipality) where a person was born.\n" +
  "comune: the name of the municipality or city.\n";

eq(buildSystem(fields), GOLDEN);

// The full published schema: header verbatim, then exactly one line per key.
const all = Object.entries(schema).map(([key, description]) => ({ key, description }));
const full = buildSystem(all);
eq(full.startsWith(HEADER), true, "header");
eq(full.slice(HEADER.length).split("\n").length - 1, all.length);

const lines = ["Comune di Arezzo", "☑ Sig.  Mario  Rossi", "nato a  Prato"];
eq(
  buildPrompt(fields, lines),
  "<|startoftext|><|im_start|>system\n" +
    GOLDEN +
    "<|im_end|>\n<|im_start|>user\n" +
    "Comune di Arezzo\n☑ Sig.  Mario  Rossi\nnato a  Prato" +
    "<|im_end|>\n<|im_start|>assistant\n",
);

eq(parseAnswer('```json\n{"comune": "Arezzo"}\n```', fields), {
  comune: "Arezzo",
});
eq(
  parseAnswer('{"comune": "Arezzo"} and that is all I found.', fields),
  { comune: "Arezzo" },
);
eq(parseAnswer('{"comune": "Arezzo", "citta": "Arezzo"}', fields), {
  comune: "Arezzo",
});
eq(parseAnswer('{"comune": 52100}', fields), { comune: "52100" });
eq(parseAnswer('{"comune": "", "luogo-nascita": "Prato"}', fields), {
  "luogo-nascita": "Prato",
});
eq(parseAnswer("I could not find anything.", fields), null);
eq(parseAnswer('{"comune": oops}', fields), null);

eq(isGrounded("Mario Rossi", lines), true);
eq(isGrounded("Marco Rossi", lines), false);

console.log("ok");
