import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const root = path.dirname(fileURLToPath(import.meta.url));

// `kb ui --dev` spawns `vp dev` and sets KB_UI_API_PORT to the backend port;
// KB_UI_DEV_PORT overrides the Vite listen port. Defaults match the CLI.
const apiPort = process.env.KB_UI_API_PORT ?? "4321";
const devPort = Number(process.env.KB_UI_DEV_PORT ?? 5173);

export default defineConfig({
  // Own lint/check block is required: without it, `vp` walks up to
  // tools/kb/vite.config.ts and inherits `lint.ignorePatterns: ["ui/**"]`,
  // so `npm run lint` / `npm run check` find zero files.
  lint: {
    ignorePatterns: ["dist/**", "storybook-static/**", "**/node_modules/**"],
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
      "@kb/ontology": path.join(root, "../src/foundation/ontology.ts"),
      "@kb/order": path.join(root, "../src/foundation/order.ts"),
      "@kb/field-type": path.join(root, "../src/foundation/field-type.ts"),
      "@kb/queries": path.join(root, "../src/foundation/query/queries.ts"),
    },
  },
  server: {
    port: devPort,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
      "/assets": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
      "/ws": {
        target: `ws://127.0.0.1:${apiPort}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
  },
});
