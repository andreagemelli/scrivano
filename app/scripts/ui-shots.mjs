/**
 * Screenshots of every UI state, in the engine the app actually ships on.
 *
 * A Tauri macOS app cannot be driven by Playwright — there is no macOS
 * webdriver. But the frontend is ordinary web code talking to Rust through one
 * object, `window.__TAURI_INTERNALS__`, so installing a fake one before the app
 * boots runs the REAL App.tsx against a fake backend: the same addPath, the same
 * classifyDoc, the same parseClass, the same store round trip. Not a mock of the
 * UI — a mock of Rust.
 *
 * Playwright's `webkit` is the same engine family as the WKWebView the app runs
 * in, which is the point: Chromium renders things macOS does not.
 *
 * Not part of `npm test` and not a dependency, because it downloads a browser:
 *
 *   npm i -D --no-save playwright && npx playwright install webkit
 *   node scripts/ui-shots.mjs            # webkit, writes docs/shots/
 *   node scripts/ui-shots.mjs chromium   # the other engine, for comparison
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import playwright from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const OUT = resolve(APP, "..", "docs", "shots");
// A production build served statically, NOT `npm run dev`. StrictMode
// double-invokes the mount effect in a dev build, and App.tsx merges the second
// history load onto the first — so anything seeded through the store shows up
// twice and the rail count is wrong. The shipped app does neither.
const BUILD = resolve(tmpdir(), "scrivano-ui-shots");
const PORT = 1488;
const ENGINE = process.argv[2] === "chromium" ? "chromium" : "webkit";

/** The default window, and the narrowest one tauri.conf.json allows. */
const WIDE = { width: 1340, height: 860 };
const NARROW = { width: 1040, height: 700 };

// ---------------------------------------------------------------------------
// The fake documents. One definition drives both the rendered page image and
// the OCR lines, so a highlight always lands where the text was drawn.
// ---------------------------------------------------------------------------

const FIXTURES = [
  {
    path: "/Users/you/Documents/dichiarazione-residenza.png",
    title: "COMUNE DI CASTELVERDE MARITTIMO",
    subtitle: "Dichiarazione di residenza",
    klass: ["declaration", "dichiarazione"],
    rows: [
      ["Cognome", "VALLE"],
      ["Nome", "LUISA"],
      ["Data di nascita", "22/12/1977"],
      ["Luogo di nascita", "PRATO"],
      ["Codice fiscale", "VLALSU77T62G999K"],
      ["Indirizzo", "VIA DEI MILLE 14"],
      ["Comune", "CASTELVERDE MARITTIMO"],
      ["Provincia", "AR"],
      ["CAP", "52025"],
      ["Telefono", "0575 900123"],
      ["Email", "l.valle@example.it"],
    ],
    // One OCR region holding a label and values together, so hiding a value
    // has to black out part of a line rather than all of it.
    sentence: "La sottoscritta VALLE LUISA, codice fiscale VLALSU77T62G999K, dichiara di risiedere qui.",
    answer: {
      nome: "LUISA",
      cognome: "VALLE",
      "data-nascita": "22/12/1977",
      "luogo-nascita": "PRATO",
      "codice-fiscale": "VLALSU77T62G999K",
      indirizzo: "VIA DEI MILLE 14",
      comune: "CASTELVERDE MARITTIMO",
    },
  },
  {
    path: "/Users/you/Documents/fattura-2411.png",
    title: "STUDIO GRAFICO ORIONE S.R.L.",
    subtitle: "Fattura n. 2411",
    klass: ["invoice", "fattura"],
    rows: [
      ["Ragione sociale", "STUDIO GRAFICO ORIONE S.R.L."],
      ["Partita IVA", "01234567890"],
      ["Sede legale", "VIA GARIBALDI 8, MILANO"],
      ["Data", "12/03/2026"],
      ["Intestatario", "COMUNE DI AREZZO"],
      ["Importo", "1.220,00 EUR"],
      ["IBAN", "IT60X0542811101000000123456"],
      ["Banca", "BANCA DI CREDITO ORIONE"],
    ],
    answer: {},
  },
  {
    path: "/Users/you/Documents/delega-ritiro.png",
    title: "DELEGA PER IL RITIRO DI DOCUMENTI",
    subtitle: "Atto di delega",
    klass: ["power-of-attorney", "delega"],
    rows: [
      ["Nome", "MARCO"],
      ["Cognome", "BERTI"],
      ["Codice fiscale", "BRTMRC81M14D612Q"],
      ["Documento", "CARTA D'IDENTITA"],
      ["Numero documento", "AZ4471902"],
      ["Rilasciato da", "COMUNE DI AREZZO"],
      ["Data rilascio", "02/09/2024"],
    ],
    answer: {},
  },
];

// ---------------------------------------------------------------------------
// The fake Rust side. Everything below runs inside the page, before app code.
// ---------------------------------------------------------------------------

/**
 * `detect` is what lid.176 would say about every page: the fixtures are all
 * Italian, so Italian and sure, unless a state needs detection to be unsure.
 */
function installBackend({ fixtures, seed, detect = ["it", 0.98] }) {
  const store = new Map(seed ? Object.entries(seed) : []);
  const listeners = new Map();
  const callbacks = new Map();
  let nextPick = 0;

  const registerCallback = (cb, once = false) => {
    const id = window.crypto.getRandomValues(new Uint32Array(1))[0];
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id);
      return cb && cb(data);
    });
    return id;
  };
  const runCallback = (id, data) => callbacks.get(id)?.(data);

  /** Draw the fixture as a page image, so screenshots show a real document. */
  function render(fixture) {
    const W = 1000;
    const H = 1414;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext("2d");
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, W, H);
    c.fillStyle = "#f3f4f6";
    c.fillRect(0, 0, W, 128);
    c.fillStyle = "#111827";
    c.font = "600 27px -apple-system, Helvetica, sans-serif";
    c.fillText(fixture.title, 64, 62);
    c.fillStyle = "#4b5563";
    c.font = "20px -apple-system, Helvetica, sans-serif";
    c.fillText(fixture.subtitle, 64, 98);

    const boxes = [];
    /** One run per word, in the font just set, as ocr.rs reports them from CTC. */
    const words = (text, x0) =>
      [...text.matchAll(/\S+/g)].map((m) => ({
        at: m.index,
        x: (x0 + c.measureText(text.slice(0, m.index)).width) / W,
        w: c.measureText(m[0]).width / W,
      }));
    let y = 196;
    for (const [label, value] of fixture.rows) {
      c.fillStyle = "#6b7280";
      c.font = "18px -apple-system, Helvetica, sans-serif";
      c.fillText(label, 64, y);
      c.fillStyle = "#111827";
      c.font = "500 20px -apple-system, Helvetica, sans-serif";
      c.fillText(value, 360, y);
      // Measured, not guessed: a box narrower than its ink would make a
      // blacked-out value look leaky in a way the real OCR boxes are not.
      const valueWidth = c.measureText(value).width;
      c.strokeStyle = "#e5e7eb";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(64, y + 18);
      c.lineTo(W - 64, y + 18);
      c.stroke();
      // Normalised 0..1, exactly as ocr.rs reports them.
      boxes.push({ text: label, box: { x: 64 / W, y: (y - 18) / H, w: 260 / W, h: 26 / H } });
      boxes.push({
        text: value,
        box: { x: 360 / W, y: (y - 20) / H, w: Math.min(560, valueWidth + 4) / W, h: 28 / H },
        runs: words(value, 360),
      });
      y += 62;
    }
    if (fixture.sentence) {
      c.fillStyle = "#111827";
      c.font = "18px -apple-system, Helvetica, sans-serif";
      c.fillText(fixture.sentence, 64, y + 10);
      const w = c.measureText(fixture.sentence).width;
      boxes.push({
        text: fixture.sentence,
        box: { x: 60 / W, y: (y - 10) / H, w: (w + 8) / W, h: 28 / H },
        runs: words(fixture.sentence, 64),
      });
    }
    c.fillStyle = "#9ca3af";
    c.font = "16px -apple-system, Helvetica, sans-serif";
    c.fillText("Ogni dato su questa pagina è inventato.", 64, H - 64);
    boxes.push({ text: "Ogni dato su questa pagina è inventato.", box: { x: 64 / W, y: (H - 84) / H, w: 420 / W, h: 24 / H } });
    return { canvas, boxes };
  }

  const pages = new Map();
  for (const f of fixtures) pages.set(f.path, render(f));

  async function pngBytes(canvas) {
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }

  /** The bytes the last read_file handed back, keyed so ocr can answer for it. */
  let lastRead = null;

  async function invoke(cmd, args) {
    switch (cmd) {
      // --- events -------------------------------------------------------
      case "plugin:event|listen": {
        const list = listeners.get(args.event) ?? [];
        list.push(args.handler);
        listeners.set(args.event, list);
        return args.handler;
      }
      case "plugin:event|unlisten": {
        const list = listeners.get(args.event) ?? [];
        const i = list.indexOf(args.id);
        if (i !== -1) list.splice(i, 1);
        return null;
      }
      case "plugin:event|emit":
        for (const h of listeners.get(args.event) ?? []) runCallback(h, args);
        return null;

      // --- store --------------------------------------------------------
      case "plugin:store|load":
        return 1;
      case "plugin:store|get_store":
        return 1;
      case "plugin:store|get":
        return store.has(args.key) ? [store.get(args.key), true] : [null, false];
      case "plugin:store|set":
        store.set(args.key, args.value);
        return null;
      case "plugin:store|save":
      case "plugin:store|reload":
        return null;

      // --- the app's own commands ---------------------------------------
      case "backend_status":
        return { ok: true, detail: "models in /Applications/Scrivano.app" };
      case "plugin:dialog|open": {
        const f = fixtures[nextPick % fixtures.length];
        nextPick++;
        return f.path;
      }
      case "plugin:fs|read_file": {
        const f = fixtures.find((x) => args.path.endsWith(x.path.split("/").pop()));
        lastRead = f;
        return await pngBytes(pages.get(f.path).canvas);
      }
      case "ocr":
        return pages.get(lastRead.path).boxes;
      case "detect_lang":
        return detect;
      case "extract": {
        // The page the prompt carries, not the file read last: a folder
        // classified again asks about documents read long ago.
        // Titles are drawn but not OCR'd, so match on the row values, which are.
        const f = fixtures.find((x) => x.rows.every(([, v]) => args.prompt.includes(v))) ?? lastRead ?? fixtures[0];
        if (args.prompt.includes("Task: document classification")) {
          window.__classified = (window.__classified ?? 0) + 1;
          // Answer with a name off the list the prompt actually carries, the way
          // the real model does — the class list is in the UI language, so a
          // hard-coded Italian answer would be rejected by parseClass in English.
          const listed = args.prompt.split("Classes:\n")[1] ?? "";
          const pick = f.klass.find((name) => listed.includes(`${name}: `)) ?? f.klass[0];
          return JSON.stringify({ class: pick });
        }
        // Extraction streams on the run's own channel, the way Tauri delivers
        // one: an index per message, so the Channel can keep them in order.
        const text = JSON.stringify(f.answer, null, 0);
        const pieces = text.match(/.{1,4}/gs) ?? [];
        for (const [index, message] of pieces.entries()) {
          runCallback(args.onToken.id, { index, message });
          await new Promise((r) => setTimeout(r, 12));
        }
        return text;
      }
      case "plugin:clipboard-manager|write_text":
        window.__clipboard = args.text;
        return null;
      // What leaves the app is kept, so the run can check it for hidden values.
      case "plugin:dialog|save":
        return "/Users/you/Documents/export.pdf";
      case "plugin:fs|write_file":
        // The body arrives as whatever the api layer made of the Uint8Array.
        window.__written = Array.from(args instanceof ArrayBuffer ? new Uint8Array(args) : new Uint8Array(args.buffer ?? args));
        return null;
      default:
        // Loud on purpose: a command nobody stubbed would otherwise resolve to
        // null and be read off the screenshot as a defect in the app.
        throw new Error(`unstubbed command: ${cmd}`);
    }
  }

  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: registerCallback,
    unregisterCallback: (id) => callbacks.delete(id),
    runCallback,
    callbacks,
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    convertFileSrc: (p) => p,
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_e, id) => callbacks.delete(id) };
}

// ---------------------------------------------------------------------------

async function waitForServer(url, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`dev server never came up at ${url}`);
}

const shots = [];

async function shot(page, name) {
  await page.waitForTimeout(160); // let a transition settle
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  shots.push(name);
}

/** Open one of the app's own dropdowns and choose the entry matching `re`. */
async function pickMenu(page, wrapper, re) {
  // The filter menu's trigger is an icon button; the others show their value.
  await page.locator(`${wrapper} .menu-btn, ${wrapper} > .icon-btn`).first().click();
  await page.waitForTimeout(120);
  await page.locator(`${wrapper} .popover button`, { hasText: re }).first().click();
  await page.waitForTimeout(160);
}

/**
 * Asking again: once for the open document from the top bar, then for the
 * whole folder from its drawer. Counted at the fake model, so a button that
 * only looks busy does not pass.
 */
async function checkReclassify(page) {
  const runs = () => page.evaluate(() => window.__classified ?? 0);
  // Which class each document is filed under, so asking again can be seen to
  // agree with asking the first time rather than only to have happened.
  const filed = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".rail-list > *")].map((el) =>
        el.classList.contains("rail-group") ? `#${el.textContent}` : el.querySelector(".doc-name")?.textContent,
      ),
    );
  const grouped = await filed();
  const before = await runs();
  await page.locator(".topbar .tag-act").click();
  await page.waitForFunction((n) => (window.__classified ?? 0) > n, before);
  await page.waitForTimeout(200);
  await shot(page, "22-classify-again");
  await page.locator(".folder.active .folder-act").first().click();
  await page.waitForSelector(".drawer");
  const all = page.locator(".drawer .sweep .btn");
  const docs = await page.locator(".doc-card").count();
  await all.click();
  await page.waitForTimeout(40);
  await shot(page, "23-classify-all");
  await page.waitForFunction((n) => (window.__classified ?? 0) >= n, before + 1 + docs, { timeout: 15000 });
  await page.waitForFunction(() => !/…/.test(document.querySelector(".drawer .sweep .btn")?.textContent ?? ""));
  const after = await runs();
  if (after !== before + 1 + docs) throw new Error(`expected ${1 + docs} classification runs, got ${after - before}`);
  const regrouped = await filed();
  if (JSON.stringify(regrouped) !== JSON.stringify(grouped)) {
    throw new Error(`asking again changed the classes: ${grouped} -> ${regrouped}`);
  }
  await page.locator(".drawer-close").click();
  await page.waitForTimeout(200);
  console.log(`  reclassify check: 1 from the top bar, ${docs} from the folder`);
}

/** The page's language reached the topbar and the schema the model will be shown. */
async function checkDetected(page) {
  const tag = (await page.locator(".topbar .tag", { hasText: /^[A-Z]{2}$/ }).first().textContent())?.trim();
  if (tag !== "IT") throw new Error(`expected the detected language IT in the topbar, got ${tag}`);
  const keys = await page.locator(".preview-row .jkey").allTextContents();
  if (!keys.includes('"cognome"')) throw new Error(`expected the Italian preset after detection, got ${keys}`);
  console.log("  detection check: IT, with the Italian preset");
}

async function openDoc(page, n = 1) {
  for (let i = 0; i < n; i++) {
    await page.getByRole("button", { name: /Choose a file|Scegli un file|Add a document|Aggiungi un documento/ }).first().click();
    await page.waitForTimeout(700);
  }
}

/**
 * The defect that started all this: a document saved by 0.1.x carries the old
 * vocabulary (Italian keys with English descriptions), and the app used to open
 * on it and then copy its schema onto every file opened afterwards. Seeded with
 * exactly such a document, so the regression cannot come back quietly.
 */
const STALE_DOC = {
  id: "stale",
  name: "vecchio-documento.pdf",
  addedAt: 1756900000000,
  pages: [{ image: "data:image/png;base64,iVBORw0KGgo=", lines: [{ text: "Comune di Arezzo" }], fromTextLayer: true }],
  fields: [
    { key: "nome", description: "the first name or given name of a person" },
    { key: "cognome", description: "the surname or family name of a person" },
  ],
  status: "done",
  result: { nome: "LUISA" },
};

async function checkUpgrade(browser, url) {
  const ctx = await browser.newContext({ viewport: WIDE, colorScheme: "light", deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("  [upgrade] page error:", e.message));
  // Detection unsure, so the folder's English stands and the check below is
  // about which schema a new document starts from, not about its language.
  await page.addInitScript(installBackend, { fixtures: FIXTURES, seed: { docs: [STALE_DOC] }, detect: null });
  await page.goto(url);
  await page.waitForSelector(".doc-card");

  // Nothing is selected: a stored document's schema is not today's preset.
  const selected = await page.locator(".doc-card.active").count();
  if (selected !== 0) throw new Error(`a stored document was auto-selected (${selected})`);

  // A newly opened document must get the shipped preset, not the old vocabulary.
  await openDoc(page, 1);
  await page.getByRole("button", { name: /^Settings$/ }).click();
  await page.waitForTimeout(220);
  const keys = await page.locator(".field .k").evaluateAll((els) => els.map((e) => e.value));
  if (keys.includes("cognome")) throw new Error(`the 0.1.x schema propagated to a new document: ${keys}`);
  if (!keys.includes("date")) throw new Error(`expected the shipped preset, got ${keys}`);
  await shot(page, "15-upgrade-from-0.1.x");
  console.log(`  upgrade check: new document got [${keys.join(", ")}]`);
  await ctx.close();
}

/**
 * What leaves the app with two values hidden: the copied text and the JSON must
 * not contain them, and the PDF must hold no text at all. The PDF is written to
 * docs/shots so it can be opened and looked at.
 */
async function checkHidden(page) {
  const hidden = ["VALLE", "VLALSU77T62G999K"];
  // The page on screen is the painted one, not the original under an overlay.
  const src = await page.locator(".page-img").first().getAttribute("src");
  if (!src?.startsWith("blob:")) throw new Error(`the page view shows the unpainted image (${src?.slice(0, 30)})`);
  await page.getByRole("button", { name: /Copy the document text/ }).click();
  const text = await page.evaluate(() => window.__clipboard);
  await page.getByRole("button", { name: /Copy the JSON/ }).click();
  const json = await page.evaluate(() => window.__clipboard);
  for (const v of hidden) {
    if (text.includes(v)) throw new Error(`copied text still carries ${v}`);
    if (json.includes(v)) throw new Error(`copied JSON still carries ${v}`);
  }
  if (!text.includes("[REDACTED]")) throw new Error("copied text has no mask in it");
  await page.getByRole("button", { name: /Download the document as a PDF/ }).click();
  await page.waitForFunction(() => window.__written, null, { timeout: 15000 });
  const bytes = Uint8Array.from(await page.evaluate(() => window.__written));
  if (bytes.length < 1000) throw new Error(`the PDF is ${bytes.length} bytes`);
  await writeFile(resolve(OUT, "hidden.pdf"), bytes);
  const size = bytes.length;
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js takes ownership of the buffer, so `bytes` is empty after this.
  const pdf = await getDocument({ data: bytes, verbosity: 0 }).promise;
  const items = (await (await pdf.getPage(1)).getTextContent()).items.length;
  if (items !== 0) throw new Error(`the PDF carries a text layer (${items} items)`);
  console.log(`  hidden check: text and JSON masked, PDF ${size} bytes with no text layer`);
}

/**
 * The regression 0.4.0 almost shipped: an eye closed on an English schema,
 * then an Italian page detected, whose preset has none of the English keys.
 * The eye is remembered by what the field means, so it must arrive closed.
 */
async function checkEyesAcrossLanguages(browser, url) {
  const ctx = await browser.newContext({ viewport: WIDE, colorScheme: "light", deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("  [eyes] page error:", e.message));
  await page.addInitScript(installBackend, { fixtures: FIXTURES });
  await page.goto(url);
  await page.waitForSelector(".app");
  await page.getByRole("button", { name: /^Settings$/ }).click();
  await page.waitForTimeout(220);
  await page.locator(".field", { has: page.locator('.k[value="name"]') }).locator(".eye").click();
  await page.locator(".drawer-close").click();
  await page.waitForTimeout(200);
  await openDoc(page, 1);
  const hidden = await page
    .locator(".preview-row", { has: page.locator(".preview-eye") })
    .locator(".jkey")
    .allTextContents();
  if (!hidden.includes('"nome"') || !hidden.includes('"cognome"')) {
    throw new Error(`an English eye on "name" did not reach the Italian preset: ${hidden}`);
  }
  await shot(page, "21-eye-across-languages");
  console.log(`  eyes check: "name" closed in English arrived as ${hidden.join(", ")}`);
  await ctx.close();
}

async function run() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  execFileSync("npx", ["vite", "build", "--outDir", BUILD, "--emptyOutDir"], {
    cwd: APP,
    stdio: "ignore",
  });
  const dev = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: BUILD,
    stdio: "ignore",
    detached: true,
  });
  const url = `http://localhost:${PORT}/`;
  try {
    await waitForServer(url);
    const browser = await playwright[ENGINE].launch();

    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: WIDE, colorScheme: scheme, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.error(`  [${scheme}] page error:`, e.message));
      // The app catches most backend errors, so without this they never surface.
      page.on("console", (m) => m.type() === "error" && console.error(`  [${scheme}] console:`, m.text()));
      await page.addInitScript(installBackend, { fixtures: FIXTURES });
      await page.goto(url);
      await page.waitForSelector(".app");

      await shot(page, `01-empty-${scheme}`);

      await openDoc(page, 1);
      await shot(page, `02-classified-${scheme}`);

      // The fixtures are Italian pages in an English folder. Nobody says so any
      // more: the page's language is detected on open, and the schema and class
      // list follow it, which is what an English schema over an Italian page
      // needed and what these shots used to have to do by hand.
      if (scheme === "light") await checkDetected(page);
      await page.getByRole("button", { name: /^Extract$/ }).click();
      await page.waitForTimeout(180);
      await shot(page, `03-extracting-${scheme}`);
      // Long enough for the whole stream to land: 04 is the finished JSON.
      await page.waitForSelector(".jsondoc", { timeout: 15000 });
      await page.waitForTimeout(200);
      await shot(page, `04-result-json-${scheme}`);

      await page.getByRole("button", { name: /^Fields$/ }).click();
      await shot(page, `05-result-fields-${scheme}`);

      // Hiding a value: the eye on two fields, and then the page, the JSON and
      // the text must all say the same thing — the value is gone.
      for (const key of ["cognome", "codice-fiscale"]) {
        await page.locator(".frow", { hasText: key }).locator(".eye").click();
      }
      await shot(page, `18-hidden-fields-${scheme}`);
      await page.getByRole("button", { name: /^JSON$/ }).click();
      await shot(page, `19-hidden-json-${scheme}`);
      await page.locator(".doc-pane .seg button", { hasText: /^Text$/ }).click();
      await shot(page, `20-hidden-text-${scheme}`);
      await page.locator(".doc-pane .seg button", { hasText: /^Page$/ }).click();
      if (scheme === "light") await checkHidden(page);
      await page.getByRole("button", { name: /^Fields$/ }).click();

      await openDoc(page, 2);
      await shot(page, `06-rail-recent-${scheme}`);
      // The new documents inherit the closed eyes, and there is no extraction
      // yet to take the values from: exporting them must be refused, and said.
      if (scheme === "light") {
        const refused = await page.locator(".doc-pane .icon-btn[aria-disabled='true']").count();
        if (refused !== 2) throw new Error(`expected both document exports refused before extraction, got ${refused}`);
      }

      await pickMenu(page, ".rail-top .menu", /class|classe/i);
      await shot(page, `07-rail-grouped-${scheme}`);
      if (scheme === "light") await checkReclassify(page);

      // Projects: a second folder, with its own classification settings.
      await page.locator(".folder-new").click();
      await page.waitForTimeout(280);
      await shot(page, `16-project-settings-${scheme}`);
      await page.locator(".drawer-close").click();
      await page.waitForTimeout(220);
      await openDoc(page, 1);
      await shot(page, `17-project-empty-then-one-${scheme}`);

      await page.getByRole("button", { name: /^Settings$/ }).click();
      await page.waitForTimeout(220);
      await shot(page, `08-settings-schema-${scheme}`);

      await page.locator(".drawer-tabs .seg button", { hasText: /Model|Modello/ }).click();
      await shot(page, `10-settings-model-${scheme}`);

      // The "?" helper: hover it and prove something appears.
      await page.locator(".drawer-body .help").first().hover();
      await page.waitForTimeout(320);
      await shot(page, `11-tooltip-${scheme}`);

      // Italian, from the language control wherever it now lives.
      const it = page.locator('[data-lang="it"], .lang button', { hasText: /^IT$/ });
      if (await it.count()) {
        await it.first().click();
        await page.waitForTimeout(220);
        await shot(page, `12-italian-${scheme}`);
      }

      await ctx.close();
    }

    // Narrowest allowed window, light only: this is where layout breaks.
    const ctx = await browser.newContext({ viewport: NARROW, colorScheme: "light", deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error("  [narrow] page error:", e.message));
    await page.addInitScript(installBackend, { fixtures: FIXTURES });
    await page.goto(url);
    await page.waitForSelector(".app");
    await openDoc(page, 2);
    await shot(page, "13-narrow-rail");
    await page.locator(".folder.active .folder-act").first().click();
    await page.waitForTimeout(220);
    await shot(page, "14-narrow-classes");
    await ctx.close();

    await checkUpgrade(browser, url);
    await checkEyesAcrossLanguages(browser, url);
    await browser.close();
    console.log(`${shots.length} shots in ${OUT} (${ENGINE})`);
  } finally {
    try {
      process.kill(-dev.pid);
    } catch {
      // already gone
    }
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
