import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { bunFileSystemLayer } from "../../context.ts";

/** Package root for `tools/kb` (parent of `src/`). */
export const KB_PKG_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** Built SPA assets directory (`tools/kb/ui/dist`). */
export const UI_DIST = join(KB_PKG_ROOT, "ui", "dist");

/** Effect FileSystem-backed existence probe. */
export function pathExists(path: string): Promise<boolean> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      return yield* fs.exists(path);
    }).pipe(Effect.provide(bunFileSystemLayer)),
  );
}
