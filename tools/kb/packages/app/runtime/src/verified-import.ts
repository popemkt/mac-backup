/**
 * Importing a repository extension from the bytes that were verified, never
 * from what is on disk when the import runs (DESIGN.md → Core boundary &
 * extensions → repository extensions). Each extensions directory a root has
 * is loaded through one load hook of its own, which matches that directory
 * by its real path and nothing else: a file whose verified source was
 * handed over is loaded from that source, and any other file there is
 * refused, so it never runs.
 *
 * Bun keys a module by its real path and loads it once per process, so the
 * hook sees each file once, and an import names the file by its real path:
 * the loader refuses an extension whose real path is not in its directory.
 */
import { sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";

/** What the hooks load: verified source by real path. */
const verified = new Map<string, string>();

/** The real extensions directories that have their hook. */
const hooked = new Set<string>();

/** A pattern matching exactly the paths under `dir`, a real path. */
function under(dir: string): RegExp {
  return new RegExp(`^${`${dir}${sep}`.replaceAll(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`);
}

function hookExtensionsDir(dir: string): void {
  if (hooked.has(dir)) return;
  hooked.add(dir);
  Bun.plugin({
    name: `kb-verified-extensions:${dir}`,
    setup(build) {
      build.onLoad({ filter: under(dir) }, (args) => {
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
 * Import the extension at `realPath`, in the extensions directory whose real
 * path is `dir`, from `source`, the bytes whose digest was trusted. Fails
 * with the import's message.
 */
export const importVerified = Effect.fn("kb.importVerified")(function* (
  dir: string,
  realPath: string,
  source: string,
): Effect.fn.Return<unknown, string> {
  hookExtensionsDir(dir);
  verified.set(realPath, source);
  return yield* Effect.tryPromise({
    try: () => import(pathToFileURL(realPath).href) as Promise<unknown>,
    catch: (err) => (err instanceof Error ? err.message : String(err)),
  });
});
