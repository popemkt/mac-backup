/**
 * The families a root composes (DESIGN.md → Extension families): every
 * bundled one, then each repository extension its `.kb/extensions` holds,
 * each with the plugin the registry loads for it and where it came from.
 * This is the one list the registry decides from, so a repository
 * extension is switched, reported and loaded by the rule a bundled family
 * is, and the one list the root's store is seeded from (`declarations`), so
 * its node, its switch and its settings are that store's nodes.
 */
import { basename } from "node:path";
import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import {
  extensionPlugin,
  type ExtensionDeclaration,
  type ExtensionEntry,
  type ExtensionFailure,
  type LoadedExtension,
} from "@kb/contracts";
import { foldSeed } from "@kb/model";
import { BUNDLED_EXTENSIONS } from "./bundled.ts";
import { codeTrustLayer } from "@kb/workspace-fs";
import { discoverExtensions } from "./extension-loader.ts";

/** A family a root composes: its declaration, its entry, and `bundled` or its module's path. */
export interface RootFamily extends ExtensionEntry {
  readonly source: string;
}

export interface RootFamilies {
  readonly families: readonly RootFamily[];
  /**
   * What the root's store is seeded from (DESIGN.md → Extension families →
   * the seed is the root's fold): the bundled declarations, then each of
   * its repository extensions'.
   */
  readonly declarations: readonly ExtensionDeclaration[];
  /** The repository modules discovery refused, each skipped. */
  readonly failures: readonly ExtensionFailure[];
}

const BUNDLED: readonly RootFamily[] = BUNDLED_EXTENSIONS.map((family) => ({
  ...family,
  source: "bundled",
}));

/**
 * The repository extensions whose declarations fold beside the bundled ones
 * and those admitted before them, in file order. One that does not (its name
 * is a bundled family's, so its node is declared twice; a seed id another
 * declaration holds; a seed that returns something other than nodes) is
 * refused like a module that fails to load, so it is neither seeded nor
 * loaded: a repository extension never stops core from opening.
 */
function admitted(extensions: readonly LoadedExtension[]): {
  readonly extensions: readonly LoadedExtension[];
  readonly failures: readonly ExtensionFailure[];
} {
  const accepted: LoadedExtension[] = [];
  const failures: ExtensionFailure[] = [];
  for (const extension of extensions) {
    const declarations = [...accepted, extension].map(({ declaration }) => declaration);
    try {
      foldSeed([...BUNDLED_DECLARATIONS, ...declarations]);
      accepted.push(extension);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      failures.push({
        file: basename(extension.source),
        error: `its declaration does not fold beside the others: ${why}`,
      });
    }
  }
  return { extensions: accepted, failures };
}

const discoveryCache = new Map<string, Effect.Effect<RootFamilies, never, FileSystem>>();

/**
 * The families `root` composes; with no root, the bundled ones alone.
 * Discovered once per root for the process lifetime, as the registry is
 * cached (an extension changed on disk needs a restart).
 */
export const rootFamilies = Effect.fn("kb.rootFamilies")(function* (
  root: string | null,
): Effect.fn.Return<RootFamilies, never, FileSystem> {
  if (root === null) return { families: BUNDLED, declarations: BUNDLED_DECLARATIONS, failures: [] };
  let discovery = discoveryCache.get(root);
  if (discovery === undefined) {
    discovery = yield* Effect.cached(
      // Which of the root's own extensions a person trusted is the root's record.
      discoverExtensions(root).pipe(
        Effect.provide(codeTrustLayer(root)),
        Effect.map((discovered) => {
          const { extensions, failures } = admitted(discovered.extensions);
          return {
            families: [
              ...BUNDLED,
              ...extensions.map((extension) => ({
                declaration: extension.declaration,
                entry: extensionPlugin(extension),
                source: extension.source,
              })),
            ],
            declarations: [
              ...BUNDLED_DECLARATIONS,
              ...extensions.map(({ declaration }) => declaration),
            ],
            failures: [...discovered.failures, ...failures],
          };
        }),
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
