/** The only file that talks to Rust. Names here must match the #[tauri::command] fns. */
import { Channel, invoke } from "@tauri-apps/api/core";
import type { Line, Sampling } from "./types";

/**
 * Tauri injects this into the webview before any app code runs, so its absence
 * means we are in a plain browser (`npm run dev`) where every call below throws.
 * Worth checking explicitly: the failures are otherwise reported as if the
 * backend were broken, which sends you looking in the wrong place.
 */
export const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ponytail: Array.from is a JSON number array on the wire, roughly 4x the bytes.
// A 200 DPI page is a few MB and OCR dwarfs the transfer, so it stays until it doesn't.
export function ocr(png: Uint8Array): Promise<Line[]> {
  return invoke("ocr", { png: Array.from(png) });
}

/**
 * One model run, its tokens on a channel of its own. The returned string is the
 * whole answer: a channel's last pieces can land after the run resolves, so
 * they are dropped rather than appended to a stream the caller has closed.
 */
export async function extract(
  prompt: string,
  sampling: Sampling,
  onToken: (t: string) => void,
): Promise<string> {
  let live = true;
  const onTokenChannel = new Channel<string>((t) => live && onToken(t));
  try {
    // Sampling goes over camelCase; the Rust struct renames to match.
    return await invoke<string>("extract", { prompt, sampling, onToken: onTokenChannel });
  } finally {
    live = false;
  }
}

/**
 * The page's language, as a code and how sure of it, or null when the folder's
 * should stand: too little text, a language outside the eight, or unsure.
 */
export function detectLang(text: string): Promise<[string, number] | null> {
  return invoke("detect_lang", { text });
}

export function backendStatus(): Promise<{ ok: boolean; detail: string }> {
  return invoke("backend_status");
}
