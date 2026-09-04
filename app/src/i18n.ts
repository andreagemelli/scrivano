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
    "The language the documents in this folder are written in. It sets the class names below and the schema a document opened in here starts from. One document can still differ — the extraction settings override it for that document alone.",
  docLanguageHelp:
    "The language THIS document is written in, overriding its folder's. Keys, descriptions and class names go into the prompt in that language, because the model was fine-tuned with the prompt and the page in the same one — an English schema on an Italian page measurably invents values. Separate from the language of this interface.",
  classHelp: "What the model decided this document is, asked for when it was opened.",

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
  valuesEditable: "Values are editable. Hover one to find it in the document text.",
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
    "The class is asked for once, as soon as a document is opened, because there is nothing to configure per run. Extraction stays manual: it depends on a schema you choose first.",
  classifyOff: "Classification is off, so documents open without a class. The list below is kept for when it is switched back on.",
  classCount: (n: number) => count(n, "class", "classes"),
  off: "Off",
  restoreClasses: "Restore the twelve trained classes",
  classesChanged:
    "This list no longer matches the twelve classes the model was fine-tuned on. It will still answer with one of these names, but only the trained ones are backed by training.",
  noClass: "no class",

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
    "La lingua in cui sono scritti i documenti di questa cartella. Determina i nomi delle classi qui sotto e lo schema da cui parte un documento aperto qui. Un singolo documento può comunque differire: le impostazioni di estrazione lo sovrascrivono solo per quel documento.",
  docLanguageHelp:
    "La lingua in cui è scritto QUESTO documento, che prevale su quella della cartella. Chiavi, descrizioni e nomi delle classi entrano nel prompt in quella lingua, perché il modello è stato addestrato con prompt e pagina nella stessa: uno schema inglese su una pagina italiana inventa valori in modo misurabile. È una scelta distinta dalla lingua di questa interfaccia.",
  classHelp: "Che cosa il modello ha deciso che sia questo documento, chiesto all'apertura.",

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
    "I valori sono modificabili. Passa il puntatore su uno per trovarlo nel testo del documento.",
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
    "La classe viene chiesta una volta sola, appena il documento viene aperto, perché non c'è nulla da configurare per ogni esecuzione. L'estrazione resta manuale: dipende da uno schema che scegli prima.",
  classifyOff: "La classificazione è disattivata, quindi i documenti si aprono senza classe. L'elenco qui sotto resta per quando la riattivi.",
  classCount: (n) => count(n, "classe", "classi"),
  off: "Off",
  restoreClasses: "Ripristina le dodici classi addestrate",
  classesChanged:
    "Questo elenco non corrisponde più alle dodici classi su cui il modello è stato addestrato. Risponderà comunque con uno di questi nomi, ma solo quelli addestrati hanno un addestramento alle spalle.",
  noClass: "senza classe",

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
