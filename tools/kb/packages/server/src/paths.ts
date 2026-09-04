import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// oxlint-disable-next-line node/no-process-env -- the config seam's single env read; every other module goes through it
const PROCESS_ENV = process.env;

/**
 * Workspace root for kb (contains `packages/`).
 *
 * Packaged installs set `KB_PKG_ROOT` on the `kb` wrapper so a bun-bundled
 * `cli.js` still finds baked UI assets. Checkout leaves it unset and resolves
 * relative to this module under `packages/server/src/`.
 */
const KB_PKG_ROOT =
  PROCESS_ENV.KB_PKG_ROOT !== undefined && PROCESS_ENV.KB_PKG_ROOT !== ""
    ? resolve(PROCESS_ENV.KB_PKG_ROOT)
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
  PROCESS_ENV.KB_UI_DIST !== undefined && PROCESS_ENV.KB_UI_DIST !== ""
    ? resolve(PROCESS_ENV.KB_UI_DIST)
    : join(UI_ROOT, "dist");

/** User data root (`KB_ROOT`), falling back to `process.cwd()`. */
export function kbDataRoot(): string {
  const value = PROCESS_ENV.KB_ROOT;
  return value !== undefined && value !== "" ? value : process.cwd();
}

/** Forward the process environment into a child, with explicit overrides. */
export function childProcessEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(PROCESS_ENV)) {
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...overrides };
}
