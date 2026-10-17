/**
 * Importing a repository extension from the bytes that were approved, never
 * from what is on disk when the import runs (DESIGN.md → Core boundary &
 * extensions → repository extensions). An extension is imported by its real
 * path and the digest that was approved (`<path>?digest=<hex>`), and a load
 * hook matching exactly that specifier serves those bytes. So each approved
 * digest is a module of its own: one trusted later in the same process is
 * the one that runs, though the module an earlier digest made stays in
 * Bun's cache.
 *
 * The specifier carries the digest's hex alone: Bun 1.4.2 reads a
 * specifier whose query holds a colon from disk, past every hook.
 */
import { Effect } from "effect";

const escaped = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** The specifiers that have their hook. */
const hooked = new Set<string>();

function serve(specifier: string, source: string): void {
  if (hooked.has(specifier)) return;
  hooked.add(specifier);
  Bun.plugin({
    name: `kb-approved:${specifier}`,
    setup(build) {
      build.onLoad({ filter: new RegExp(`^${escaped(specifier)}$`) }, () => ({
        contents: source,
        loader: "ts",
      }));
    },
  });
}

/**
 * Import the extension at `realPath` from `source`, the bytes whose digest
 * (`sha256:<hex>`) was approved. Fails with the import's message.
 */
export const importVerified = Effect.fn("kb.importVerified")(function* (
  realPath: string,
  source: string,
  digest: string,
): Effect.fn.Return<unknown, string> {
  const specifier = `${realPath}?digest=${digest.slice(digest.indexOf(":") + 1)}`;
  serve(specifier, source);
  return yield* Effect.tryPromise({
    try: () => import(specifier) as Promise<unknown>,
    catch: (err) => (err instanceof Error ? err.message : String(err)),
  });
});
