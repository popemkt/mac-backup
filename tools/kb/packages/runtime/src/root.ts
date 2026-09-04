import { Effect, Schema } from "effect";
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
  return yield* new RootNotFoundError({
    message: "no .kb/ found (walked up from cwd); pass --root or run kb init",
  });
});

/** No `.kb/` above cwd and none named. Tagged: the CLI maps it to exit 2. */
export class RootNotFoundError extends Schema.TaggedError<RootNotFoundError>()(
  "Kb/RootNotFoundError",
  { message: Schema.String },
) {}
