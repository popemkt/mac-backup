/**
 * Importing a repository extension from the bytes that were verified, never
 * from what is on disk when the import runs (DESIGN.md → Core boundary &
 * extensions → repository extensions). Bun loads every module under a
 * `.kb/extensions/` directory through one load hook: a file whose verified
 * source was handed over is loaded from that source, and any other file
 * there (a helper an extension reaches for, statically or not) is refused,
 * so it never runs.
 *
 * Bun keys a module by its real path and loads it once per process, so the
 * hook sees each file once, and an import names the file by its real path.
 */
import { pathToFileURL } from "node:url";
import { Effect } from "effect";

/** What the hook loads under a `.kb/extensions/`: verified source by real path. */
const verified = new Map<string, string>();

const EXTENSIONS_DIR = /[\\/]\.kb[\\/]extensions[\\/]/;

let hooked = false;

function hookExtensionLoads(): void {
  if (hooked) return;
  hooked = true;
  Bun.plugin({
    name: "kb-verified-extensions",
    setup(build) {
      build.onLoad({ filter: EXTENSIONS_DIR }, (args) => {
        const source = verified.get(args.path);
        if (source === undefined) {
          throw new Error(`${args.path} is not a verified extension; it does not run`);
        }
        return { contents: source, loader: "ts" };
      });
    },
  });
}

/**
 * Import the extension at `realPath` from `source`, the bytes whose digest
 * was trusted. Fails with the import's message.
 */
export const importVerified = Effect.fn("kb.importVerified")(function* (
  realPath: string,
  source: string,
): Effect.fn.Return<unknown, string> {
  hookExtensionLoads();
  verified.set(realPath, source);
  return yield* Effect.tryPromise({
    try: () => import(pathToFileURL(realPath).href) as Promise<unknown>,
    catch: (err) => (err instanceof Error ? err.message : String(err)),
  });
});
