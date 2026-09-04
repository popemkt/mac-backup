import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { dirname, join, resolve } from "node:path";

/**
 * Resolve the kb repo root (Effect).
 * --root wins; otherwise walk cwd upward looking for `.kb/`.
 * When `allowCreate` (init), fall back to cwd if none found.
 */
export const resolveRootEffect = Effect.fn("kb.resolveRoot")(function* (
  opts: { root?: string; cwd?: string; allowCreate?: boolean } = {},
): Effect.fn.Return<string, RootNotFoundError, FileSystem> {
  if (opts.root !== undefined && opts.root !== "") return resolve(opts.root);

  const fs = yield* FileSystem;
  let dir = resolve(opts.cwd ?? process.cwd());
  for (;;) {
    const hasKb = yield* fs.exists(join(dir, ".kb")).pipe(Effect.orElseSucceed(() => false));
    if (hasKb) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (opts.allowCreate === true) return resolve(opts.cwd ?? process.cwd());
  return yield* Effect.fail(
    new RootNotFoundError("no .kb/ found (walked up from cwd); pass --root or run kb init"),
  );
});

export class RootNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RootNotFoundError";
  }
}
