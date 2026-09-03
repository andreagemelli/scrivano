/** The only file that talks to Rust. Names here must match the #[tauri::command] fns. */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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

/** Subscribe before invoking, or the first tokens of a fast page are lost. */
export async function extract(
  prompt: string,
  sampling: Sampling,
  onToken: (t: string) => void,
): Promise<string> {
  const unlisten = await listen<string>("token", (e) => onToken(e.payload));
  try {
    // Sampling goes over camelCase; the Rust struct renames to match.
    return await invoke<string>("extract", { prompt, sampling });
  } finally {
    unlisten();
  }
}

export function backendStatus(): Promise<{ ok: boolean; detail: string }> {
  return invoke("backend_status");
}
