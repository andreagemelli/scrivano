import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

// pdf.js loads these at runtime by URL. Missing wasm silently breaks JBIG2 and
// JPEG2000, which is exactly the scanned-form case, so all four ship.
const pdfjsAssets = ["cmaps", "standard_fonts", "wasm", "iccs"].map((d) => ({
  src: `node_modules/pdfjs-dist/${d}`,
  dest: "",
}));

// The worker is copied rather than imported with ?url so we can prepend the
// upsert polyfill to it. A worker gets a fresh global scope, so the copy
// main.tsx loads does not reach it, and pdf.js calls getOrInsertComputed on
// both sides. See src/webkit-shims.js.
const polyfill = readFileSync("src/webkit-shims.js", "utf8");

const pdfjsWorker = {
  src: "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  dest: "pdfjs",
  transform: (content: string) => `${polyfill}\n${content}`,
};

export default defineConfig({
  plugins: [react(), viteStaticCopy({ targets: [...pdfjsAssets, pdfjsWorker] })],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
