/**
 * The families a root composes (DESIGN.md → Extension families): every
 * bundled one, then each repository extension its `.kb/extensions` holds,
 * each with the plugin the registry loads for it and where it came from.
 * This is the one list the registry decides from, so a repository
 * extension is switched, reported and loaded by the rule a bundled family
 * is.
 */
import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { extensionPlugin, type ExtensionEntry, type ExtensionFailure } from "@kb/contracts";
import { BUNDLED_EXTENSIONS } from "./bundled.ts";
import { codeTrustLayer } from "@kb/workspace-fs";
import { discoverExtensions } from "./extension-loader.ts";

/** A family a root composes: its declaration, its entry, and `bundled` or its module's path. */
export interface RootFamily extends ExtensionEntry {
  readonly source: string;
}

export interface RootFamilies {
  readonly families: readonly RootFamily[];
  /** The repository modules discovery refused, each skipped. */
  readonly failures: readonly ExtensionFailure[];
}

const BUNDLED: readonly RootFamily[] = BUNDLED_EXTENSIONS.map((family) => ({
  ...family,
  source: "bundled",
}));

const discoveryCache = new Map<string, Effect.Effect<RootFamilies, never, FileSystem>>();

/**
 * The families `root` composes; with no root, the bundled ones alone.
 * Discovered once per root for the process lifetime, as the registry is
 * cached (an extension changed on disk needs a restart).
 */
export const rootFamilies = Effect.fn("kb.rootFamilies")(function* (
  root: string | null,
): Effect.fn.Return<RootFamilies, never, FileSystem> {
  if (root === null) return { families: BUNDLED, failures: [] };
  let discovery = discoveryCache.get(root);
  if (discovery === undefined) {
    discovery = yield* Effect.cached(
      // Which of the root's own extensions a person trusted is the root's record.
      discoverExtensions(root).pipe(
        Effect.provide(codeTrustLayer(root)),
        Effect.map(({ extensions, failures }) => ({
          // A repository extension declares nothing, so it reads as a declaration of its name alone.
          families: [
            ...BUNDLED,
            ...extensions.map((extension) => ({
              declaration: { name: extension.name, label: extension.name },
              entry: extensionPlugin(extension),
              source: extension.source,
            })),
          ],
          failures,
        })),
      ),
    );
    discoveryCache.set(root, discovery);
  }
  return yield* discovery;
});

/** Test hook: forget every root's discovery, so a fresh root is discovered again. */
export function resetRootFamilies(): void {
  discoveryCache.clear();
}
