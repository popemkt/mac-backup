import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { mergeConfig } from "vite";
import type { StorybookConfig } from "@storybook/react-vite";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Storybook gets its own `viteFinal` rather than importing `../vite.config.ts`
 * directly: that config's `defineConfig` comes from `vite-plus` (the `vp`
 * dev/build/test/lint tool) and layers in `vp`-only options (`lint`, `check`)
 * that the plain Vite builder Storybook drives does not understand. The
 * pieces a story actually needs — path aliases and the Tailwind plugin — are
 * repeated here; everything else (the dev proxy, `vp` lint config) is
 * `kb ui`'s serving concern, not the viewer's.
 */
const config: StorybookConfig = {
  stories: ["../src/catalog/**/*.stories.tsx"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  addons: ["@storybook/addon-a11y"],
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      plugins: [tailwindcss()],
      resolve: {
        alias: {
          "@": path.join(root, "src"),
          "@kb/protocol": path.join(root, "../src/surface/protocol.ts"),
          "@kb/canvas": path.join(root, "../src/canvas/doc.ts"),
          "@kb/ontology": path.join(root, "../src/foundation/ontology.ts"),
          "@kb/order": path.join(root, "../src/foundation/order.ts"),
          "@kb/field-type": path.join(root, "../src/foundation/field-type.ts"),
        },
      },
    }),
};

export default config;
