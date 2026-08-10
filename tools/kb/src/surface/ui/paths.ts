import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Package root for kb (contains `ui/dist` and, in checkout, `src/`).
 *
 * Packaged installs set `KB_PKG_ROOT` on the `kb` wrapper so a bun-bundled
 * `cli.js` still finds baked UI assets. Checkout / `bun src/.../cli.ts` leaves
 * it unset and resolves relative to this module under `src/surface/ui/`.
 */
export const KB_PKG_ROOT =
  process.env.KB_PKG_ROOT && process.env.KB_PKG_ROOT.length > 0
    ? resolve(process.env.KB_PKG_ROOT)
    : resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Built SPA assets directory (`$KB_PKG_ROOT/ui/dist`).
 *
 * Optional `KB_UI_DIST` override for tests / odd layouts — not required for
 * the Nix package (wrapper sets `KB_PKG_ROOT` instead).
 */
export const UI_DIST =
  process.env.KB_UI_DIST && process.env.KB_UI_DIST.length > 0
    ? resolve(process.env.KB_UI_DIST)
    : join(KB_PKG_ROOT, "ui", "dist");
