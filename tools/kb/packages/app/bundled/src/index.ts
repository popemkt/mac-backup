/**
 * What kb bundles, as data both hosts read: the declarations of core and of
 * every bundled family, and the seed they fold to (DESIGN.md → Extension
 * families → the seed is the bundled fold).
 *
 * This is the one list of bundled families. The server's registry pairs
 * each declaration here with its server entry (`runtime/src/bundled.ts`),
 * and fails at load on a family with no entry or an entry with no family,
 * so the two hosts cannot disagree on what is bundled. It is a composition
 * root (`EXTENSION_ROOTS`) that loads nothing: it reads each family's shared
 * package for its declaration only.
 *
 * It is `scope:shared` because the page reads the same fold as the server:
 * the offline graph and the UI's fixtures are seeded from it. So a bundled
 * family declares itself in its shared package, never its server one.
 */
import { canvasExtension } from "@kb/canvas";
import { chartExtension } from "@kb/chart";
import { checkExtension } from "@kb/check";
import { codeExtension } from "@kb/code";
import type { ExtensionDeclaration } from "@kb/contracts";
import { docsExtension } from "@kb/docs";
import { labExtension } from "@kb/lab";
import { foldSeed, type KbNode } from "@kb/model";
import { coreExtension } from "@kb/operations";

/**
 * Every bundled family, in the order the registry loads them. The order is
 * data a fresh store keeps: it orders the families' view types under
 * `sys.views`, after core's.
 */
export const BUNDLED_FAMILIES: readonly ExtensionDeclaration[] = [
  docsExtension,
  canvasExtension,
  labExtension,
  checkExtension,
  codeExtension,
  chartExtension,
];

/** Core's declaration first, then each bundled family's: what the seed folds. */
export const BUNDLED_DECLARATIONS: readonly ExtensionDeclaration[] = [
  coreExtension,
  ...BUNDLED_FAMILIES,
];

/**
 * The seed a store is opened with: the bundled declarations folded in order.
 * Pure data — it opens nothing and no registry is consulted, so every surface
 * seeds the same nodes whatever it loads. Stamped at `at`, else now.
 */
export function bundledSeed(at?: string): KbNode[] {
  return foldSeed(BUNDLED_DECLARATIONS, at);
}
