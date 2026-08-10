import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Package root for `tools/kb` (parent of `src/`). */
export const KB_PKG_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** Built SPA assets directory (`tools/kb/ui/dist`). */
export const UI_DIST = join(KB_PKG_ROOT, "ui", "dist");
