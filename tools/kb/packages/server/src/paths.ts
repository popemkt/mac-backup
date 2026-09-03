import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Workspace root for kb (contains `packages/`).
 *
 * Packaged installs set `KB_PKG_ROOT` on the `kb` wrapper so a bun-bundled
 * `cli.js` still finds baked UI assets. Checkout leaves it unset and resolves
 * relative to this module under `packages/server/src/`.
 */
export const KB_PKG_ROOT =
  process.env.KB_PKG_ROOT && process.env.KB_PKG_ROOT.length > 0
    ? resolve(process.env.KB_PKG_ROOT)
    : resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Source root of the `@kb/ui` package (`$KB_PKG_ROOT/packages/ui`). */
export const UI_ROOT = join(KB_PKG_ROOT, "packages", "ui");

/**
 * Built SPA assets directory (`$UI_ROOT/dist`).
 *
 * Optional `KB_UI_DIST` override for tests / odd layouts — not required for
 * the Nix package (wrapper sets `KB_PKG_ROOT` instead).
 */
export const UI_DIST =
  process.env.KB_UI_DIST && process.env.KB_UI_DIST.length > 0
    ? resolve(process.env.KB_UI_DIST)
    : join(UI_ROOT, "dist");
