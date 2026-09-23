/** npm test. Guards hiding a value: if this fails, something meant to be hidden is showing. */
import { REDACTED, locate, maskLine, shownResult, maskedText, hiddenValues, pdfFromJpegs, place, unplaced } from "./redact";
import { mergeIntoLines, squash, wordRuns } from "./pdf";
import type { Box, Line, Page } from "./types";

function eq(got: unknown, want: unknown, what = "") {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) throw new Error(`${what}\n  got  ${g}\n  want ${w}`);
}

const page = (...lines: (string | Line)[]): Page => ({
  image: "",
  fromTextLayer: false,
  lines: lines.map((l) => (typeof l === "string" ? { text: l, box: { x: 0.1, y: 0.1, w: 0.8, h: 0.02 } } : l)),
});

// Found wherever it is, however it is cased or spaced, every time it occurs.
{
  const p = page("Cognome e nome: ROSSI  Mario", "Firma di Rossi Mario", "nato a Prato");
  const { spans, missing } = locate([p], ["Rossi Mario", "Milano"]);
  eq(spans[0][0], [[16, 28]], "case and double space");
  eq(spans[0][1], [[9, 20]], "second occurrence");
  eq(spans[0][2], [], "untouched line");
  eq(missing, ["Milano"], "a value nowhere on the page is reported, not ignored");
  eq(maskLine(p.lines[0].text, spans[0][0]), `Cognome e nome: ${REDACTED}`);
}

// A value the page breaks across two lines is hidden on both.
{
  const p = page("Indirizzo: VIA DEI", "MILLE 14, Prato");
  const { spans } = locate([p], ["via dei mille 14"]);
  eq(spans[0], [[[11, 18]], [[0, 8]]], "across a line break");
  eq(maskedText([p], spans), `Indirizzo: ${REDACTED}\n${REDACTED}, Prato`);
}

// Short values only match whole words: hiding "M" must not black out "Mario".
{
  const p = page("Sesso: M", "Mario Rossi, anni 12", "tel 3312");
  const { spans } = locate([p], ["M", "12"]);
  eq(spans[0], [[[7, 8]], [[18, 20]], []], "short values are whole words");
  // In a script with no spaces there are no word edges to require.
  const zh = page("姓名王五性别男");
  eq(locate([zh], ["王五"]).spans[0], [[[2, 4]]], "CJK matches inside a run of text");
}

// Overlapping values merge into one box instead of two stacked ones.
eq(locate([page("Mario Rossi")], ["Mario Rossi", "Rossi"]).spans[0][0], [[0, 11]], "merged");

// The JSON that leaves the app, and which values count as hidden.
{
  const fields = [
    { key: "nome", description: "", hidden: true },
    { key: "comune", description: "" },
    { key: "cf", description: "", hidden: true },
  ];
  const result = { cf: "", comune: "Prato", nome: "Mario" };
  eq(shownResult(result, fields), { nome: REDACTED, comune: "Prato", cf: REDACTED }, "schema order");
  eq(hiddenValues(fields, result), ["Mario"], "an empty value hides nothing on the page");
  eq(hiddenValues(fields, undefined), []);
  // Rename or drop a hidden field after the run: its old value is on screen
  // nowhere, so it must leave in nothing either.
  const renamed = [{ key: "nominativo", description: "", hidden: true }, { key: "comune", description: "" }];
  eq(shownResult({ nome: "Mario", comune: "Prato" }, renamed), { comune: "Prato" }, "a stranded key is not exported");
}

// A line with no box can be masked in the text but not painted in the image.
// Counted per line, however often the value occurs on it.
{
  const p = page({ text: "Mario Rossi, Rossi" }, "Mario Rossi");
  const { spans } = locate([p], ["Rossi"]);
  eq(unplaced([p], spans), 1);
}

// Geometry. Without word positions the whole line goes: an even spread over the
// line's box was measured to leak.
{
  const box: Box = { x: 0.1, y: 0.5, w: 0.4, h: 0.02 };
  const b = place({ text: "Nome: Mario Rossi", box }, [6, 17])!;
  eq([b.x, b.w], [box.x, box.w], "no runs, whole line");
  eq(b.y < box.y && b.y + b.h > box.y + box.h, true, "taller than the text");
  // A text-layer box stops at the baseline: the bar reaches the descenders.
  eq(b.y + b.h >= box.y + box.h * 1.25, true, "reaches below the baseline");
}

// With word runs the box starts in the value's first word and ends in its last,
// padded outward, however wide the gap before it.
{
  const line: Line = {
    text: "Cognome   ROSSI MARIO, nato",
    box: { x: 0.1, y: 0.5, w: 0.8, h: 0.02 },
    runs: [
      { at: 0, x: 0.1, w: 0.1 },
      { at: 10, x: 0.6, w: 0.05 },
      { at: 16, x: 0.66, w: 0.06 },
      { at: 23, x: 0.8, w: 0.1 },
    ],
  };
  const b = place(line, [10, 21])!;
  // One column of ROSSI is 0.01, of "MARIO," 0.01: padded by 1.5 each side.
  eq(Math.abs(b.x - 0.585) < 1e-9, true, `starts at the value, not in the gap: ${b.x}`);
  eq(Math.abs(b.x + b.w - (0.66 + 0.05 + 0.015)) < 1e-9, true, `ends after MARIO: ${b.x + b.w}`);
  eq(b.x + b.w < 0.8, true, "stops short of the next word");
  const whole = place(line, [0, 27])!;
  eq(whole.x <= 0.1 && whole.x + whole.w >= 0.9, true, "a whole line reaches both box edges");
}

// Wide characters take two columns inside a run.
{
  const line: Line = { text: "ab王五", box: { x: 0, y: 0, w: 0.6, h: 0.02 }, runs: [{ at: 0, x: 0, w: 0.6 }] };
  const b = place(line, [2, 4])!;
  // Six columns over 0.6: the value starts at column 2 (0.2), padded by 1.5 columns.
  eq(Math.abs(b.x - (0.2 - 0.15)) < 1e-9, true, `wide columns: ${b.x}`);
}

// Word runs from a measure: each word gets its share of the item's exact width,
// and a script without spaces is split per character.
{
  const box: Box = { x: 0.2, y: 0, w: 0.4, h: 0.02 };
  const len = (t: string) => t.length;
  const round = (runs: { at: number; x: number; w: number }[] | undefined) =>
    runs?.map((r) => [r.at, +r.x.toFixed(6), +r.w.toFixed(6)]);
  eq(round(wordRuns("Nome  MARIO", box, len)), round([
    { at: 0, x: 0.2, w: (0.4 * 4) / 11 },
    { at: 6, x: 0.2 + (0.4 * 6) / 11, w: (0.4 * 5) / 11 },
  ]));
  eq(wordRuns("王五 ab", box, len)!.map((r) => r.at), [0, 1, 3]);
  eq(wordRuns("x", box, () => 0), undefined, "no measure, no runs");
}

// squash is the model's normalisation, byte for byte, with a map on the side.
for (const raw of ["  Prot.  n. 2024 ", "a\u00a0b\tc", "", "   ", "G R D", "王 五  x"]) {
  const { text, at } = squash(raw);
  eq(text, raw.replace(/\s+/g, " ").trim(), `squash ${JSON.stringify(raw)}`);
  for (let i = 0; i < raw.length; i++) {
    if (!/\s/.test(raw[i])) eq(text[at[i]], raw[i], `map ${JSON.stringify(raw)}@${i}`);
  }
}

// Merged text-layer lines keep where each fragment sits, and the text the model
// reads is exactly what it was before runs existed.
{
  const f = (text: string, x: number, w: number): Line => ({ text, box: { x, y: 0.1, w, h: 0.02 } });
  const [line] = mergeIntoLines([f("Cognome", 0.1, 0.1), f(" ROSSI ", 0.8, 0.1)]);
  eq(line.text, "Cognome ROSSI");
  eq(line.runs, [
    { at: 0, x: 0.1, w: 0.1 },
    { at: 7, x: 0.8, w: 0.1 },
  ]);
  const [one] = mergeIntoLines([f("Nome", 0.1, 0.1)]);
  eq(one.runs, undefined, "one unmeasured fragment: no word positions");
  // Measured fragments bring their word runs, re-based onto the merged text.
  const a = { ...f("Nome  e", 0.1, 0.2), runs: [{ at: 0, x: 0.1, w: 0.1 }, { at: 6, x: 0.25, w: 0.05 }] };
  const b = { ...f("cognome", 0.5, 0.2), runs: [{ at: 0, x: 0.5, w: 0.2 }] };
  const [m] = mergeIntoLines([a, b]);
  eq(m.text, "Nome e cognome");
  eq(m.runs!.map((r) => [r.at, r.x]), [[0, 0.1], [5, 0.25], [7, 0.5]], "re-based through the squash");
}

// The PDF: every xref offset lands on its object, and pdf.js opens it.
{
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const bytes = pdfFromJpegs([
    { jpeg, width: 1654, height: 2339 },
    { jpeg, width: 200, height: 100 },
  ]);
  const text = new TextDecoder("latin1").decode(bytes);
  const start = Number(/startxref\n(\d+)/.exec(text)![1]);
  eq(text.slice(start, start + 4), "xref", "startxref");
  const entries = text.slice(start).split("\n").slice(3, 3 + 8);
  entries.forEach((e, i) => {
    eq(e.length, 19, "xref entries are 20 bytes with their newline");
    const off = Number(e.slice(0, 10));
    eq(text.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1}`);
  });
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({ data: bytes, verbosity: 0 }).promise;
  eq(pdf.numPages, 2, "pages");
  const view = (await pdf.getPage(1)).view.map((n: number) => Math.round(n));
  eq(view, [0, 0, 595, 842], "a 200 DPI A4 page comes out A4");
  // Nothing of the source survives but pixels: no text to extract.
  eq((await (await pdf.getPage(1)).getTextContent()).items.length, 0, "no text layer");
}

console.log("ok");
