import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Own lint/check block is required: without it, `vp` walks up to
  // tools/kb/vite.config.ts and inherits `lint.ignorePatterns: ["ui/**"]`,
  // so `npm run lint` / `npm run check` find zero files.
  lint: {
    ignorePatterns: ["dist/**", "**/node_modules/**"],
    options: {
      // Authoritative typecheck remains `tsc --noEmit` (`npm run typecheck`).
      typeCheck: false,
      typeAware: false,
    },
  },
  check: {
    // Prefer explicit `--no-fmt` in scripts; keep fmt off by default here too.
    fmt: false,
  },
  plugins: [tailwindcss(), react()],
  build: {
    // `/assets/*` is the kb media route (.kb/assets) on the server; keep the
    // bundler's hashed output out of that namespace or index.html 404s.
    assetsDir: "static",
  },
  resolve: {
    alias: {
      "@": path.join(root, "src"),
      "@kb/protocol": path.join(root, "../src/surface/protocol.ts"),
      "@kb/canvas": path.join(root, "../src/canvas/doc.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4321",
        changeOrigin: true,
      },
      "/assets": {
        target: "http://127.0.0.1:4321",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:4321",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
