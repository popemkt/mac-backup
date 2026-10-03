import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * The sandbox frame's script (DESIGN.md → Sandbox → The frame), built on its
 * own: one classic script with every import inlined, QuickJS's WebAssembly
 * included, sharing no chunk with the page. Classic, because the frame has an
 * opaque origin and a module script would be fetched with CORS; one file,
 * because its CSP allows no connection to fetch a second.
 */
export default defineConfig({
  lint: { ignorePatterns: ["dist/**", "storybook-static/**", "**/node_modules/**"] },
  check: { fmt: false },
  publicDir: false,
  // QuickJS's loader reads import.meta.url only to find a .wasm file beside
  // it; this variant embeds its WebAssembly, so the URL is never used.
  define: { "import.meta.url": "undefined" },
  build: {
    outDir: "dist/sandbox",
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: path.join(root, "src/sandbox/frame.ts"),
      formats: ["iife"],
      name: "kbSandboxFrame",
      fileName: () => "frame.js",
    },
  },
});
