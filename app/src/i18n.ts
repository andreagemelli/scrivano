/**
 * Every word on screen, in both languages.
 *
 * English is the source of truth: `IT` is typed against it, so a string added
 * here and forgotten there is a build error rather than an English word in the
 * middle of an Italian panel. Anything with a number or a name in it is a
 * function, because word order is not the same in the two languages and
 * concatenating fragments at the call site quietly assumes it is.
 *
 * The setting is one language, not two: it picks the interface words AND the
 * language the schema keys and class names are written in. The model was
 * trained with the prompt in the document's own language, so those cannot be
 * chosen independently of each other without teaching that distinction here,
 * and one switch is the honest version of "which language are we working in".
 */
import { createContext, useContext } from "react";
import type { Lang, Status } from "./types";

/** n of one thing: "1 field", "3 fields". The count is always shown. */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const EN = {
  lang: "en" as Lang,
  /** The `lang` attribute on <html>, for hyphenation and screen readers. */
  htmlLang: "en",
  docLanguage: "Documents are in",
  projectLanguageHelp:
    "The language the documents in this folder are written in — or, while detection is on, the one to fall back on when a page's own cannot be told. It sets the class names below and the schema a document opened in here starts from. One document can still differ: the extraction settings override it for that document alone.",
  detectLang: "Detect each document's language",
  detectLangHelp:
    "Reads each page as it opens and picks which of the eight languages it is in, so its schema and class names go to the model in that language. A page in none of them, or one it is unsure of, gets the folder's language. It runs on this computer, like everything else.",
  langDetected: (name: string, pct: number) =>
    `${name}, detected from the page (${pct}% sure). If it is wrong, change it in the extraction settings.`,
  langChosen: (name: string) => `${name}, chosen for this document in the extraction settings.`,
  langFolder: (name: string) => `${name}, the folder's language.`,
  langUnsure: (name: string) =>
    `${name}, the folder's language: the page's own is not one of the eight, or could not be told.`,
  docLanguageHelp:
    "The language THIS document is written in, overriding its folder's. Keys, descriptions and class names go into the prompt in that language, because the model was fine-tuned with the prompt and the page in the same one — an English schema on an Italian page measurably invents values. Separate from the language of this interface.",
  classHelp: "What the model decided this document is, asked for when it was opened or when you asked again.",

  // Topbar
  betaTitle: "Beta: the model is still moving.",
  statusLabel: {
    empty: "No document",
    reading: "Reading",
    classifying: "Classifying",
    ready: "Ready",
    extracting: "Extracting",
    done: "Done",
    failed: "Failed",
  } as Record<Status, string>,
  modelUnavailable: "Model unavailable",
  extract: "Extract",
  extracting: "Extracting…",
  runExtraction: "Run the extraction",
  settings: "Settings",
  settingsTitle: "Settings",
  close: "Close",
  dismissWarning: "Dismiss the warning",

  // Blockers, shown next to a disabled Extract button
  needDocument: "Add a document first",
  stillReading: "Still reading the document",
  stillClassifying: "Classification in progress",
  alreadyExtracting: "An extraction is already running",
  noText: "No text found in this document",
  needField: "Add at least one field",
  needKey: "Every field needs a key",
  noDevServer: "Not available in the browser dev server",
  noModel: "The extraction model is unavailable",

  // Failures
  backendDown: "The extraction model is not responding. Restart Scrivano and try again.",
  noTauri:
    "This is the browser dev server: opening files, OCR and the model are all unavailable. Run npm run tauri dev instead.",
  unsupported: (exts: string[]) => `Unsupported file. Use ${exts.join(", ")}.`,
  pickerFailed: (detail: string) => `Could not open the file picker. ${detail}`,
  documentsFilter: "Documents",

  // Document rail
  collapseRail: "Collapse the document list",
  expandRail: "Expand the document list",
  documents: (n: number) => count(n, "document", "documents"),
  railEmpty: "Nothing yet. Documents you open stay in this list.",
  addDocument: "Add a document",
  deleteDocument: (name: string) => `Delete ${name}`,
  fields: (n: number) => count(n, "field", "fields"),
  rowState: { reading: "reading", classifying: "classifying", extracting: "extracting", failed: "failed" },
  justNow: "just now",
  minutesAgo: (n: number) => `${n} min ago`,
  hoursAgo: (n: number) => `${n} h ago`,
  daysAgo: (n: number) => `${n} d ago`,

  // Document pane
  document: "Document",
  pages: (n: number) => count(n, "page", "pages"),
  lines: (n: number) => count(n, "line", "lines"),
  pageTab: "Page",
  textTab: "Text",
  dropToOpen: "Drop to open this file",
  dropHere: "Drag a document here to read its text",
  chooseFile: "Choose a file",
  formats: "PDF, PNG, JPEG, WebP or TIFF",
  readFailed: (detail: string) => `Could not read this document: ${detail}`,
  page: (n: number) => `Page ${n}`,
  fromTextLayer: "PDF text",
  fromOcr: "OCR",
  emptyPage: "No text found on this page.",

  // Reading progress
  readingFile: "Reading the file",
  readingImage: "Reading the image",
  runningOcr: "Running OCR",
  renderingPage: (n: number, of: number) => `Rendering page ${n} of ${of}`,
  ocrOnPage: (n: number, of: number) => `OCR on page ${n} of ${of}`,
  encodeFailed: "could not encode the rendered page",

  // Results
  extraction: "Extraction",
  openSchema: "Open the schema in settings",
  schemaCount: (n: number) => `Schema · ${count(n, "field", "fields")}`,
  speedHelp:
    "How fast the model writes, in tokens per second. Measured from the first token, so it excludes reading the prompt.",
  valuesEditable:
    "Values are editable. Hover one to find it in the document. The eye beside a key hides its value, in the JSON and in the document.",
  fieldsView: "Fields",
  jsonView: "JSON",
  copied: "Copied",
  copyJson: "Copy the JSON",
  downloadJson: "Download the JSON",
  extractFailed: (detail: string) => `Extraction failed: ${detail}`,
  notJson: "The model did not return valid JSON. The raw output is below.",
  pressExtract: "Press Extract to fill the schema from this document.",
  addThenExtract: "Add a document, then press Extract.",
  modelReading: "The model is reading the document.",
  valueOf: (key: string) => `Value of ${key}`,
  notOnPage: "not in the document",
  notOnPageHelp:
    "This text appears nowhere in the document, so the model most likely invented it.",
  // Hiding a value
  hideValue: (key: string) => `Hide ${key}`,
  hiddenValue: (key: string) => `${key}, hidden`,
  hiddenHelp:
    "Hidden. The JSON you copy or download says [REDACTED] instead, and wherever the value occurs in the document it is blacked out, on the page and in the text. Click to show it again.",
  notBlackedOut: "not blacked out",
  notBlackedOutHelp:
    "This value is hidden in the JSON, but it was not found on its own in the document's text, so wherever it appears on the page it is not blacked out. Check the page before you share it. If the value is wrong, open the eye, correct it to read exactly as on the page, then close the eye again.",
  copyText: (n: number) =>
    n === 0 ? "Copy the document text" : `Copy the document text, ${count(n, "hidden value", "hidden values")} replaced`,
  downloadPdf: (n: number) =>
    n === 0
      ? "Download the document as a PDF"
      : `Download the document as a PDF, ${count(n, "hidden value", "hidden values")} blacked out`,
  unplaced: (n: number) =>
    n === 1
      ? "A hidden value sits on a line with no position on the page, so a PDF cannot black it out. The text copy still masks it."
      : `Hidden values sit on ${n} lines with no position on the page, so a PDF cannot black them out. The text copy still masks them.`,
  hiddenUnsettled:
    "A field is hidden, but there is no extraction to take its value from, so nothing can be blacked out yet. Run Extract before you copy or download this document.",
  hiddenNotFound: (n: number) =>
    n === 1
      ? "A hidden value was not found in the document's text, so it is not blacked out wherever it appears on the page. Check the page before you share it."
      : `${n} hidden values were not found in the document's text, so they are not blacked out wherever they appear on the page. Check the page before you share it.`,
  hiddenPictures:
    "This PDF also draws pictures or form fields, which can show a value its text does not carry. Hidden values are found by that text, so check those parts of the page before you share it.",
  rawWithheld:
    "The model's answer did not parse, so a hidden value in it cannot be told apart from the rest. It is shown here but not copied or downloaded.",
  pdfFailed: (detail: string) => `Could not write the PDF. ${detail}`,
  emptyFields: (n: number) => count(n, "field with no value", "fields with no value"),
  emptyFieldsHelp: (n: number): string =>
    n === 1
      ? "The model returned nothing for this key, so it is absent from the JSON."
      : "The model returned nothing for these keys, so they are absent from the JSON.",

  // Row editor. The schema and the class list are the same widget, and the two
  // are never the same words: a class is not a key and saying so matters when
  // the panel is warning you that the model never saw one.
  schema: "Schema",
  model: "Model",
  classes: "Classes",
  presets: "Presets",
  pasteJson: "Paste JSON",
  removeRow: (name: string) => `Remove ${name}`,
  rows: {
    field: {
      help: "Descriptions go into the model's prompt. Write them in the document's language, the way the presets do: that is how the model was trained.",
      filter: "Filter the keys",
      filterLabel: "Filter the preset keys",
      alreadyIn: "already in the schema",
      noMatch: "No key matches the filter.",
      jsonLabel: "Schema as JSON",
      jsonPlaceholder: '{ "name": "the full name of a person" }',
      replaceAll: "Replace every field",
      expectedObject: "expected a JSON object mapping key to description",
      namePlaceholder: "key",
      nameLabel: (n: number) => `Key of field ${n}`,
      descriptionLabel: (n: number) => `Description of field ${n}`,
      descriptionPlaceholder: "what this field means",
      untrained: "untrained key",
      untrainedHelp: "This key was not in the fine-tuning schema: the model has never seen it.",
      theRow: "the field",
      empty: "No fields. Add one so there is something to extract.",
      add: "Add field",
    },
    class: {
      help: "Class names go into the model's prompt. Write them in the document's language, the way the presets do: that is how the model was trained.",
      filter: "Filter the classes",
      filterLabel: "Filter the trained classes",
      alreadyIn: "already in the list",
      noMatch: "No class matches the filter.",
      jsonLabel: "Classes as JSON",
      jsonPlaceholder: '{ "invoice": "a request for payment for goods or services" }',
      replaceAll: "Replace every class",
      expectedObject: "expected a JSON object mapping class to description",
      namePlaceholder: "class",
      nameLabel: (n: number) => `Name of class ${n}`,
      descriptionLabel: (n: number) => `Description of class ${n}`,
      descriptionPlaceholder: "what this kind of document is",
      untrained: "untrained class",
      untrainedHelp:
        "This class was not among the twelve the model was fine-tuned on: it has never seen it, and will pick it only by the description you write here.",
      theRow: "the class",
      empty: "No classes. Add one, or restore the twelve the model was trained on.",
      add: "Add class",
    },
  },

  // Classification
  classifyOnOpen: "Classify on open",
  classifyHelp:
    "The class is asked for as soon as a document is opened, because there is nothing to configure per run, and again when its language is corrected. You can always ask again from the top bar or below. Extraction stays manual: it depends on a schema you choose first.",
  classifyOff: "Classification on open is off, so documents open without a class. They can still be classified by hand, from the list below.",
  classCount: (n: number) => count(n, "class", "classes"),
  off: "Off",
  restoreClasses: "Restore the twelve trained classes",
  classesChanged:
    "This list no longer matches the twelve classes the model was fine-tuned on. It will still answer with one of these names, but only the trained ones are backed by training.",
  noClass: "no class",
  classifyNow: "Classify",
  classifyNowHelp: "Ask the model what kind of document this is, from this folder's class list.",
  classifyAgain: "Classify again",
  classifyAgainHelp:
    "Ask the model again, from this folder's class list as it is now — after the list has been edited, or the document's language corrected.",
  noClasses: "This folder has no classes to choose from",
  classifyAll: (n: number) =>
    n === 0 ? "Classify again" : `Classify ${n === 1 ? "the document" : `all ${n} documents`} again`,
  classifyingAll: (i: number, n: number) => `Classifying ${i} of ${n}…`,
  classifyAllHelp:
    "Asks again for the class of every document in this folder, one after another, from the list above. Worth doing after the list has changed: a document keeps the class it got, even one no longer on the list, until it is asked again.",
  sweepRunning: "A folder is being classified again",
  noDocumentsHere: "There are no documents in this folder",

  // Projects
  project: "Project",
  projectSettings: "Project settings",
  projectName: "Name",
  firstProject: "Documents",
  newProject: "New project",
  newProjectName: "Untitled project",
  projectHelp: (n: number) =>
    `${count(n, "document", "documents")} in here. Every document opened while this project is chosen is classified the way it says below — a folder of invoices and a folder of forms rarely want the same list.`,
  deleteProject: "Delete project",
  deleteProjectHelp: (n: number) =>
    n === 0
      ? "Deletes this project. It is empty, so nothing else changes."
      : `Deletes this project. Its ${count(n, "document", "documents")} move to the first one rather than being thrown away.`,
  chooseProject: "Choose a project",
  lastProject: "The last project cannot be deleted: documents have to open somewhere.",
  openProjectSettings: "Project settings",

  // Ordering the rail
  order: "Order",
  orderRecent: "Most recent",
  orderName: "Name",
  orderClass: "Group by class",
  unclassified: "Unclassified",

  // Model settings
  greedy: "greedy decoding",
  sampling: "sampling on",
  greedyHelp:
    "Temperature 0, so the run is deterministic: the same document and the same schema always give the same answer.",
  samplingHelp:
    "Sampling is on, so two runs on the same document can differ. The seed makes one run repeatable.",
  resetModel: "Restore the model defaults",
  reset: "Restore",
  ignoredAtZero: " Ignored while the temperature is 0.",
  range: (min: number, max: number) => ` From ${min} to ${max}.`,
  temperature: "Temperature",
  temperatureHelp: "0 means deterministic. Higher lets the model wander.",
  topK: "Top-k",
  topKHelp: "0 turns it off. Otherwise only the k most likely tokens are considered.",
  topP: "Top-p",
  topPHelp: "1 turns it off. Otherwise the least likely tokens are cut.",
  maxTokens: "Max tokens",
  maxTokensHelp: "The longest answer the model is allowed to write.",
  seed: "Seed",
  seedHelp: "Fixes the random draw, so a sampled run is repeatable.",
};

export type Dict = typeof EN;

const IT: Dict = {
  lang: "it",
  htmlLang: "it",
  docLanguage: "I documenti sono in",
  projectLanguageHelp:
    "La lingua in cui sono scritti i documenti di questa cartella, oppure, finché il rilevamento è attivo, quella da usare quando la lingua di una pagina non si riesce a stabilire. Determina i nomi delle classi qui sotto e lo schema da cui parte un documento aperto qui. Un singolo documento può comunque differire: le impostazioni di estrazione lo sovrascrivono solo per quel documento.",
  detectLang: "Rileva la lingua di ogni documento",
  detectLangHelp:
    "Legge ogni pagina appena si apre e sceglie in quale delle otto lingue è scritta, così schema e nomi delle classi arrivano al modello in quella lingua. Una pagina in nessuna di esse, o di cui non è sicuro, prende la lingua della cartella. Gira su questo computer, come tutto il resto.",
  langDetected: (name, pct) =>
    `Lingua rilevata dalla pagina: ${name} (certezza del ${pct}%). Se è sbagliata, cambiala nelle impostazioni di estrazione.`,
  langChosen: (name) => `Lingua scelta per questo documento nelle impostazioni di estrazione: ${name}.`,
  langFolder: (name) => `Lingua della cartella: ${name}.`,
  langUnsure: (name) =>
    `Lingua della cartella: ${name}. Quella della pagina non è fra le otto, o non si è potuta stabilire.`,
  docLanguageHelp:
    "La lingua in cui è scritto QUESTO documento, che prevale su quella della cartella. Chiavi, descrizioni e nomi delle classi entrano nel prompt in quella lingua, perché il modello è stato addestrato con prompt e pagina nella stessa: uno schema inglese su una pagina italiana inventa valori in modo misurabile. È una scelta distinta dalla lingua di questa interfaccia.",
  classHelp:
    "Che cosa il modello ha deciso che sia questo documento, chiesto all'apertura o quando l'hai richiesto.",

  betaTitle: "Versione beta: il modello è ancora in evoluzione.",
  statusLabel: {
    empty: "Nessun documento",
    reading: "Lettura",
    classifying: "Classificazione",
    ready: "Pronto",
    extracting: "Estrazione",
    done: "Completato",
    failed: "Errore",
  },
  modelUnavailable: "Modello non disponibile",
  extract: "Estrai",
  extracting: "Estrazione…",
  runExtraction: "Avvia l'estrazione",
  settings: "Impostazioni",
  settingsTitle: "Impostazioni",
  close: "Chiudi",
  dismissWarning: "Chiudi l'avviso",

  needDocument: "Aggiungi prima un documento",
  stillReading: "Lettura del documento in corso",
  stillClassifying: "Classificazione in corso",
  alreadyExtracting: "Estrazione già in corso",
  noText: "Nessun testo trovato in questo documento",
  needField: "Aggiungi almeno un campo",
  needKey: "Ogni campo deve avere una chiave",
  noDevServer: "Non disponibile nel server di sviluppo del browser",
  noModel: "Il modello di estrazione non è disponibile",

  backendDown: "Il modello di estrazione non risponde. Riavvia Scrivano e riprova.",
  noTauri:
    "Questo è il server di sviluppo del browser: apertura dei file, OCR e modello non sono disponibili. Avvia invece npm run tauri dev.",
  unsupported: (exts) => `File non supportato. Usa ${exts.join(", ")}.`,
  pickerFailed: (detail) => `Impossibile aprire la finestra di selezione. ${detail}`,
  documentsFilter: "Documenti",

  collapseRail: "Comprimi l'elenco dei documenti",
  expandRail: "Espandi l'elenco dei documenti",
  documents: (n) => count(n, "documento", "documenti"),
  railEmpty: "Ancora niente. I documenti che apri restano in questo elenco.",
  addDocument: "Aggiungi un documento",
  deleteDocument: (name) => `Elimina ${name}`,
  fields: (n) => count(n, "campo", "campi"),
  rowState: {
    reading: "lettura",
    classifying: "classificazione",
    extracting: "estrazione",
    failed: "errore",
  },
  justNow: "adesso",
  minutesAgo: (n) => `${n} min fa`,
  hoursAgo: (n) => `${n} h fa`,
  daysAgo: (n) => `${n} g fa`,

  document: "Documento",
  pages: (n) => count(n, "pagina", "pagine"),
  lines: (n) => count(n, "riga", "righe"),
  pageTab: "Pagina",
  textTab: "Testo",
  dropToOpen: "Rilascia per aprire questo file",
  dropHere: "Trascina qui un documento per leggerne il testo",
  chooseFile: "Scegli un file",
  formats: "PDF, PNG, JPEG, WebP o TIFF",
  readFailed: (detail) => `Impossibile leggere questo documento: ${detail}`,
  page: (n) => `Pagina ${n}`,
  fromTextLayer: "testo del PDF",
  fromOcr: "OCR",
  emptyPage: "Nessun testo trovato in questa pagina.",

  readingFile: "Lettura del file",
  readingImage: "Lettura dell'immagine",
  runningOcr: "OCR in corso",
  renderingPage: (n, of) => `Rendering della pagina ${n} di ${of}`,
  ocrOnPage: (n, of) => `OCR sulla pagina ${n} di ${of}`,
  encodeFailed: "impossibile codificare la pagina renderizzata",

  extraction: "Estrazione",
  openSchema: "Apri lo schema nelle impostazioni",
  schemaCount: (n) => `Schema · ${count(n, "campo", "campi")}`,
  speedHelp:
    "Velocità di generazione del modello, token al secondo. Misurata dal primo token, quindi non include la lettura del prompt.",
  valuesEditable:
    "I valori sono modificabili. Passa il puntatore su uno per trovarlo nel documento. L'occhio accanto a una chiave ne nasconde il valore, nel JSON e nel documento.",
  fieldsView: "Campi",
  jsonView: "JSON",
  copied: "Copiato",
  copyJson: "Copia il JSON",
  downloadJson: "Scarica il JSON",
  extractFailed: (detail) => `Estrazione fallita: ${detail}`,
  notJson: "Il modello non ha restituito un JSON valido. Qui sotto l'output grezzo.",
  pressExtract: "Premi Estrai per riempire lo schema con i dati di questo documento.",
  addThenExtract: "Aggiungi un documento, poi premi Estrai.",
  modelReading: "Il modello sta leggendo il documento.",
  valueOf: (key) => `Valore di ${key}`,
  notOnPage: "non nel documento",
  notOnPageHelp:
    "Questo testo non compare da nessuna parte nel documento, quindi il modello lo ha probabilmente inventato.",
  hideValue: (key) => `Nascondi ${key}`,
  hiddenValue: (key) => `${key}, nascosto`,
  hiddenHelp:
    "Nascosto. Il JSON che copi o scarichi riporta [REDACTED] al suo posto, e ovunque il valore compaia nel documento viene oscurato, sulla pagina e nel testo. Fai clic per mostrarlo di nuovo.",
  notBlackedOut: "non oscurato",
  notBlackedOutHelp:
    "Questo valore è nascosto nel JSON, ma non è stato trovato a sé nel testo del documento, quindi dove compare sulla pagina non viene oscurato. Controlla la pagina prima di condividerla. Se il valore è sbagliato, apri l'occhio, correggilo perché si legga esattamente come sulla pagina, poi richiudi l'occhio.",
  copyText: (n) =>
    n === 0 ? "Copia il testo del documento" : `Copia il testo del documento, con ${count(n, "valore nascosto sostituito", "valori nascosti sostituiti")}`,
  downloadPdf: (n) =>
    n === 0
      ? "Scarica il documento in PDF"
      : `Scarica il documento in PDF, con ${count(n, "valore nascosto oscurato", "valori nascosti oscurati")}`,
  unplaced: (n) =>
    n === 1
      ? "Un valore nascosto si trova su una riga senza posizione sulla pagina, quindi un PDF non può oscurarlo. La copia del testo lo maschera comunque."
      : `Dei valori nascosti si trovano su ${n} righe senza posizione sulla pagina, quindi un PDF non può oscurarli. La copia del testo li maschera comunque.`,
  hiddenUnsettled:
    "Un campo è nascosto, ma non c'è un'estrazione da cui prenderne il valore, quindi per ora non si può oscurare nulla. Esegui Estrai prima di copiare o scaricare questo documento.",
  hiddenNotFound: (n) =>
    n === 1
      ? "Un valore nascosto non è stato trovato nel testo del documento, quindi non viene oscurato dove compare sulla pagina. Controlla la pagina prima di condividerla."
      : `${n} valori nascosti non sono stati trovati nel testo del documento, quindi non vengono oscurati dove compaiono sulla pagina. Controlla la pagina prima di condividerla.`,
  hiddenPictures:
    "Questo PDF contiene anche immagini o campi di modulo, che possono mostrare un valore assente dal suo testo. I valori nascosti vengono cercati in quel testo, quindi controlla quelle parti della pagina prima di condividerla.",
  rawWithheld:
    "La risposta del modello non è un JSON valido, quindi un valore nascosto non si distingue dal resto. È mostrata qui ma non viene copiata né scaricata.",
  pdfFailed: (detail) => `Impossibile scrivere il PDF. ${detail}`,
  emptyFields: (n) => count(n, "campo senza valore", "campi senza valore"),
  emptyFieldsHelp: (n) =>
    n === 1
      ? "Il modello non ha restituito nulla per questa chiave, quindi è assente dal JSON."
      : "Il modello non ha restituito nulla per queste chiavi, quindi sono assenti dal JSON.",

  schema: "Schema",
  model: "Modello",
  classes: "Classi",
  presets: "Predefiniti",
  pasteJson: "Incolla JSON",
  removeRow: (name) => `Rimuovi ${name}`,
  rows: {
    field: {
      help: "Le descrizioni finiscono nel prompt del modello. Scrivile nella lingua del documento, come fanno i predefiniti: è così che il modello è stato addestrato.",
      filter: "Filtra le chiavi",
      filterLabel: "Filtra le chiavi predefinite",
      alreadyIn: "già nello schema",
      noMatch: "Nessuna chiave corrisponde al filtro.",
      jsonLabel: "Schema in formato JSON",
      jsonPlaceholder: '{ "nome": "il nome di battesimo della persona" }',
      replaceAll: "Sostituisci tutti i campi",
      expectedObject: "atteso un oggetto JSON che associa chiave e descrizione",
      namePlaceholder: "chiave",
      nameLabel: (n) => `Chiave del campo ${n}`,
      descriptionLabel: (n) => `Descrizione del campo ${n}`,
      descriptionPlaceholder: "che cosa significa questo campo",
      untrained: "chiave non addestrata",
      untrainedHelp:
        "Questa chiave non era nello schema di fine-tuning: il modello non l'ha mai vista.",
      theRow: "il campo",
      empty: "Nessun campo. Aggiungine uno per poter estrarre qualcosa.",
      add: "Aggiungi campo",
    },
    class: {
      help: "I nomi delle classi finiscono nel prompt del modello. Scrivili nella lingua del documento, come fanno i predefiniti: è così che il modello è stato addestrato.",
      filter: "Filtra le classi",
      filterLabel: "Filtra le classi addestrate",
      alreadyIn: "già nell'elenco",
      noMatch: "Nessuna classe corrisponde al filtro.",
      jsonLabel: "Classi in formato JSON",
      jsonPlaceholder: '{ "fattura": "una richiesta di pagamento per beni o servizi" }',
      replaceAll: "Sostituisci tutte le classi",
      expectedObject: "atteso un oggetto JSON che associa classe e descrizione",
      namePlaceholder: "classe",
      nameLabel: (n) => `Nome della classe ${n}`,
      descriptionLabel: (n) => `Descrizione della classe ${n}`,
      descriptionPlaceholder: "che tipo di documento è",
      untrained: "classe non addestrata",
      untrainedHelp:
        "Questa classe non era fra le dodici su cui il modello è stato addestrato: non l'ha mai vista, e la sceglierà solo in base alla descrizione che scrivi qui.",
      theRow: "la classe",
      empty: "Nessuna classe. Aggiungine una, o ripristina le dodici su cui il modello è addestrato.",
      add: "Aggiungi classe",
    },
  },

  classifyOnOpen: "Classifica all'apertura",
  classifyHelp:
    "La classe viene chiesta appena il documento viene aperto, perché non c'è nulla da configurare per ogni esecuzione, e di nuovo quando se ne corregge la lingua. Puoi sempre richiederla dalla barra in alto o qui sotto. L'estrazione resta manuale: dipende da uno schema che scegli prima.",
  classifyOff: "La classificazione all'apertura è disattivata, quindi i documenti si aprono senza classe. Puoi comunque classificarli a mano, dall'elenco qui sotto.",
  classCount: (n) => count(n, "classe", "classi"),
  off: "Off",
  restoreClasses: "Ripristina le dodici classi addestrate",
  classesChanged:
    "Questo elenco non corrisponde più alle dodici classi su cui il modello è stato addestrato. Risponderà comunque con uno di questi nomi, ma solo quelli addestrati hanno un addestramento alle spalle.",
  noClass: "senza classe",
  classifyNow: "Classifica",
  classifyNowHelp: "Chiedi al modello che tipo di documento è, dall'elenco delle classi di questa cartella.",
  classifyAgain: "Classifica di nuovo",
  classifyAgainHelp:
    "Chiedi di nuovo al modello, dall'elenco delle classi di questa cartella così com'è ora: dopo averlo modificato, o dopo aver corretto la lingua del documento.",
  noClasses: "Questa cartella non ha classi fra cui scegliere",
  classifyAll: (n) =>
    n === 0 ? "Classifica di nuovo" : n === 1 ? "Classifica di nuovo il documento" : `Classifica di nuovo tutti i ${n} documenti`,
  classifyingAll: (i, n) => `Classificazione ${i} di ${n}…`,
  classifyAllHelp:
    "Chiede di nuovo la classe di ogni documento di questa cartella, uno dopo l'altro, dall'elenco qui sopra. Utile dopo averlo cambiato: un documento tiene la classe che ha ricevuto, anche se non è più nell'elenco, finché non viene richiesta di nuovo.",
  sweepRunning: "Una cartella è già in corso di classificazione",
  noDocumentsHere: "In questa cartella non ci sono documenti",

  project: "Progetto",
  projectSettings: "Impostazioni del progetto",
  projectName: "Nome",
  firstProject: "Documenti",
  newProject: "Nuovo progetto",
  newProjectName: "Progetto senza nome",
  projectHelp: (n) =>
    `${count(n, "documento", "documenti")} qui dentro. Ogni documento aperto mentre questo progetto è scelto viene classificato come dice qui sotto: una cartella di fatture e una di moduli raramente vogliono lo stesso elenco.`,
  deleteProject: "Elimina il progetto",
  deleteProjectHelp: (n) =>
    n === 0
      ? "Elimina questo progetto. È vuoto, quindi non cambia nient'altro."
      : `Elimina questo progetto. I suoi ${count(n, "documento", "documenti")} passano al primo, invece di essere buttati via.`,
  chooseProject: "Scegli un progetto",
  lastProject: "L'ultimo progetto non si può eliminare: i documenti devono pur aprirsi da qualche parte.",
  openProjectSettings: "Impostazioni del progetto",

  order: "Ordina",
  orderRecent: "Più recenti",
  orderName: "Nome",
  orderClass: "Raggruppa per classe",
  unclassified: "Senza classe",

  greedy: "decodifica greedy",
  sampling: "campionamento attivo",
  greedyHelp:
    "Temperatura 0, quindi l'esecuzione è deterministica: stesso documento e stesso schema danno sempre la stessa risposta.",
  samplingHelp:
    "Il campionamento è attivo, quindi due esecuzioni sullo stesso documento possono differire. Il seed rende ripetibile una esecuzione.",
  resetModel: "Ripristina i valori predefiniti del modello",
  reset: "Ripristina",
  ignoredAtZero: " Ignorato finché la temperatura è 0.",
  range: (min, max) => ` Da ${min} a ${max}.`,
  temperature: "Temperatura",
  temperatureHelp: "0 significa deterministico. Valori più alti lasciano divagare il modello.",
  topK: "Top-k",
  topKHelp: "0 la disattiva. Altrimenti considera solo i k token più probabili.",
  topP: "Top-p",
  topPHelp: "1 lo disattiva. Altrimenti taglia i token meno probabili.",
  maxTokens: "Token massimi",
  maxTokensHelp: "La risposta più lunga che il modello può scrivere.",
  seed: "Seed",
  seedHelp: "Fissa l'estrazione casuale, così una esecuzione campionata è ripetibile.",
};

export const DICTS: Record<Lang, Dict> = { en: EN, it: IT };

/**
 * English until the stored preference arrives, which is one paint. The context
 * is what every component reads, so nothing takes the language as a prop.
 */
export const Words = createContext<Dict>(EN);

export function useT(): Dict {
  return useContext(Words);
}
