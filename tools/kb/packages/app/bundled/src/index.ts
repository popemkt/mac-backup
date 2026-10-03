/**
 * What kb bundles, as data both hosts read: the declarations of core and of
 * every bundled family, and the seed they fold to (DESIGN.md → Extension
 * families → the seed is the bundled fold).
 *
 * It is `scope:shared` because the page reads the same fold as the server:
 * the offline graph and the UI's fixtures are seeded from it. Only a
 * family's server entry needs Bun, and that is resolved per declaration by
 * the runtime's registry.
 */
import type { ExtensionDeclaration } from "@kb/contracts";
import { foldSeed, type KbNode } from "@kb/model";
import { coreExtension } from "@kb/operations";

/** Core's declaration first, then each bundled family's, in the registry's order. */
export const BUNDLED_DECLARATIONS: readonly ExtensionDeclaration[] = [coreExtension];

/**
 * The seed a store is opened with: the bundled declarations folded in order.
 * Pure data — it opens nothing and no registry is consulted, so every surface
 * seeds the same nodes whatever it loads. Stamped at `at`, else now.
 */
export function bundledSeed(at?: string): KbNode[] {
  return foldSeed(BUNDLED_DECLARATIONS, at);
}
