import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.join(root, "src"),
      "@kb/protocol": path.join(root, "../src/surface/protocol.ts"),
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
    include: ["src/**/*.test.ts"],
  },
});
