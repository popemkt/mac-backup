import { defineConfig } from "vite-plus";

/**
 * Backend package tooling only. `tools/kb/ui` is a separate Vite+ package with
 * its own config and node_modules — do not load or lint it from here.
 *
 * `lint.options.typeCheck` stays off: oxlint-tsgolint type-check is not the
 * gate for this Bun/Effect tree. Zero-error typechecking is `tsc --noEmit`
 * via `npm run typecheck` (also in pre-commit).
 */
export default defineConfig({
  lint: {
    ignorePatterns: ["ui/**", "**/node_modules/**", "dist/**"],
    options: {
      typeCheck: false,
      typeAware: false,
    },
  },
  check: {
    // Prefer explicit `--no-fmt` in scripts; keep fmt off by default here too.
    fmt: false,
  },
});
