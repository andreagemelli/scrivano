//! Decoding of the bundled LFM2.5 GGUF through llama.cpp.

use anyhow::{anyhow, Result};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use std::num::NonZeroU32;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

/// Room to spare above prompt + generation, still well under the trained context.
const CTX_SLACK: u32 = 64;

/// Sampling knobs from the UI. Mirrors `Sampling` in types.ts.
#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Sampling {
    /// <= 0.0 means greedy: no sampling, the historical behaviour.
    pub temperature: f32,
    /// <= 0 disables top-k.
    pub top_k: i32,
    /// >= 1.0 disables top-p.
    pub top_p: f32,
    pub max_tokens: i32,
    pub seed: u32,
}

impl Sampling {
    /// The UI is not trusted with the context budget.
    fn max_new_tokens(&self) -> usize {
        self.max_tokens.clamp(16, 4096) as usize
    }

    fn sampler(&self) -> LlamaSampler {
        if self.temperature <= 0.0 {
            return LlamaSampler::greedy();
        }
        // Order matches llama.cpp's own chain: truncate the tail, then flatten
        // the distribution, then draw from what is left.
        let mut chain = Vec::new();
        if self.top_k > 0 {
            chain.push(LlamaSampler::top_k(self.top_k));
        }
        if self.top_p < 1.0 {
            chain.push(LlamaSampler::top_p(self.top_p, 1));
        }
        chain.push(LlamaSampler::temp(self.temperature));
        chain.push(LlamaSampler::dist(self.seed));
        LlamaSampler::chain_simple(chain)
    }
}

// The backend may be initialised exactly once per process and is a zero sized
// handle, so it lives forever. The model is behind the same lock that serialises
// generation: one 350M model on a laptop gains nothing from concurrent decodes,
// and unload() needs to be able to drop it.
static BACKEND: OnceLock<LlamaBackend> = OnceLock::new();
static MODEL: Mutex<Option<LlamaModel>> = Mutex::new(None);

fn load(gguf: &Path) -> Result<LlamaModel> {
    if BACKEND.get().is_none() {
        let _ = BACKEND.set(LlamaBackend::init()?);
    }
    let mut params = LlamaModelParams::default();
    if cfg!(target_os = "macos") {
        // Metal is compiled in on macOS aarch64; offload everything to it.
        params = params.with_n_gpu_layers(999);
    }
    Ok(LlamaModel::load_from_file(
        BACKEND.get().expect("just set"),
        gguf,
        &params,
    )?)
}

/// Releases the model. llama.cpp's Metal backend asserts during its atexit
/// teardown if model buffers are still alive, so the app calls this on quit.
pub fn unload() {
    if let Ok(mut slot) = MODEL.lock() {
        slot.take();
    }
}

/// Runs the prompt verbatim (it already carries its own BOS and ChatML frame),
/// calls `on_token` with every decoded piece, and returns the full text.
pub fn run(
    gguf: &Path,
    prompt: &str,
    sampling: &Sampling,
    mut on_token: impl FnMut(&str),
) -> Result<String> {
    let max_new_tokens = sampling.max_new_tokens();
    let mut slot = MODEL
        .lock()
        .map_err(|e| anyhow!("the model lock is poisoned: {e}"))?;
    if slot.is_none() {
        *slot = Some(load(gguf)?);
    }
    let model = slot.as_ref().expect("just loaded");
    let backend = BACKEND.get().expect("loaded with the model");

    // add_bos = false: buildPrompt() in the frontend already emits <|startoftext|>.
    let tokens = model.str_to_token(prompt, AddBos::Never)?;
    let n_ctx = tokens.len() as u32 + max_new_tokens as u32 + CTX_SLACK;
    let n_ctx_train = model.n_ctx_train();
    if n_ctx > n_ctx_train {
        return Err(anyhow!(
            "document too long: {} prompt tokens, the model's context is {}",
            tokens.len(),
            n_ctx_train
        ));
    }

    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(n_ctx))
        .with_n_batch(n_ctx)
        .with_n_threads(std::thread::available_parallelism().map_or(4, |n| n.get() as i32));
    let mut ctx = model.new_context(backend, ctx_params)?;

    let mut batch = LlamaBatch::new(tokens.len().max(1), 1);
    batch.add_sequence(&tokens, 0, false)?;
    ctx.decode(&mut batch)?;

    // The chat template closes the turn with <|im_end|>, which is not always
    // flagged EOG in the GGUF, so stop on it explicitly as well.
    let im_end = model
        .str_to_token("<|im_end|>", AddBos::Never)?
        .first()
        .copied();

    let mut sampler = sampling.sampler();
    let mut decoder = encoding_rs::UTF_8.new_decoder();
    let mut out = String::new();
    let mut pos = tokens.len() as i32;

    for _ in 0..max_new_tokens {
        let token = sampler.sample(&ctx, -1);
        sampler.accept(token);
        if model.is_eog_token(token) || Some(token) == im_end {
            break;
        }
        let piece = model.token_to_piece(token, &mut decoder, false, None)?;
        on_token(&piece);
        out.push_str(&piece);

        batch.clear();
        batch.add(token, pos, &[0], true)?;
        pos += 1;
        ctx.decode(&mut batch)?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::Sampling;
    use std::path::PathBuf;

    /// The extraction prompt exactly as prompt.ts builds it. Italian keys with
    /// Italian descriptions, because that is the language of the page below.
    const PROMPT: &str = "<|startoftext|><|im_start|>system\n\
         You are an expert document analysis model.\n\
         Task: information extraction\n\
         Return a JSON object with exactly the keys listed below, in the same order. \
         Every value must be copied verbatim from the document. Omit a key whose value \
         is absent.\n\n\
         Schema:\n\
         nome: il nome di battesimo della persona.\n\
         data: una data.\n\
         <|im_end|>\n\
         <|im_start|>user\n\
         Nome\nMario Rossi\nData\n12/03/2019\n\
         <|im_end|>\n\
         <|im_start|>assistant\n";

    /// End to end decode against the bundled GGUF, both sampler paths. Catches a
    /// wrong BOS, a missed stop token and a broken streaming loop in one go.
    #[test]
    fn extracts_json() {
        let gguf = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("model.gguf");
        if !gguf.exists() {
            eprintln!("skipping: run scripts/fetch-resources.sh first");
            return;
        }

        let greedy = Sampling {
            temperature: 0.0,
            top_k: 0,
            top_p: 1.0,
            max_tokens: 1024,
            seed: 42,
        };
        let mut streamed = String::new();
        let out = super::run(&gguf, PROMPT, &greedy, |p| streamed.push_str(p)).expect("generation");
        eprintln!("greedy: {out}");
        assert_eq!(streamed, out, "streamed pieces must rebuild the full text");
        assert!(out.trim_start().starts_with('{'), "expected a JSON object");
        assert!(out.contains("Mario"), "expected the name back");
        assert!(!out.contains("<|im_end|>"), "stop token leaked into the output");

        let sampled = Sampling {
            temperature: 0.7,
            top_k: 40,
            top_p: 0.95,
            max_tokens: 1024,
            seed: 42,
        };
        let mut streamed = String::new();
        let out = super::run(&gguf, PROMPT, &sampled, |p| streamed.push_str(p)).expect("generation");
        eprintln!("sampled: {out}");
        assert!(!out.trim().is_empty(), "sampled decode returned nothing");
        assert_eq!(streamed, out, "streamed pieces must rebuild the full text");
        assert!(!out.contains("<|im_end|>"), "stop token leaked into the output");

        super::unload();
    }

    /// The classification prompt, same page, three of the twelve classes. Its
    /// own test because the two tasks share a decode path and nothing else: a
    /// header that drifts from make_docai.py shows up here and nowhere else.
    #[test]
    fn classifies() {
        let gguf = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("model.gguf");
        if !gguf.exists() {
            eprintln!("skipping: run scripts/fetch-resources.sh first");
            return;
        }

        const PROMPT: &str = "<|startoftext|><|im_start|>system\n\
             You are an expert document analysis model.\n\
             Task: document classification\n\
             Assign the document to exactly one of the classes listed below. \
             Answer with a JSON object of the form {\"class\": \"<class>\"}.\n\n\
             Classes:\n\
             fattura: una richiesta di pagamento per beni o servizi.\n\
             delega: un atto con cui una persona incarica un'altra di agire per suo conto.\n\
             curriculum: un documento che riassume studi ed esperienze lavorative di una persona.\n\
             <|im_end|>\n\
             <|im_start|>user\n\
             FATTURA N. 42\nData 12/03/2019\nImponibile 100,00\nIVA 22%\nTotale 122,00\n\
             <|im_end|>\n\
             <|im_start|>assistant\n";

        let greedy = Sampling {
            temperature: 0.0,
            top_k: 0,
            top_p: 1.0,
            max_tokens: 64,
            seed: 42,
        };
        let out = super::run(&gguf, PROMPT, &greedy, |_| {}).expect("generation");
        eprintln!("class: {out}");
        assert!(out.contains("\"class\""), "expected a {{\"class\": ...}} object");
        assert!(out.contains("fattura"), "expected the invoice class back");
        assert!(!out.contains("<|im_end|>"), "stop token leaked into the output");

        super::unload();
    }
}
