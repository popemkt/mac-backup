/**
 * What kb bundles, as data both hosts read: the declarations of core and of
 * every bundled family, and the seed they fold to (DESIGN.md → Extension
 * families → the seed is the bundled fold).
 *
 * This is the one list of bundled families, and of the families a host
 * composes itself. The server's registry pairs
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
import { agentExtension } from "@kb/agent";
import { canvasExtension } from "@kb/canvas";
import { chartExtension } from "@kb/chart";
import { collectionsExtension } from "@kb/collections";
import { checkExtension } from "@kb/check";
import { codeExtension } from "@kb/code";
import type { ExtensionDeclaration } from "@kb/contracts";
import { docsExtension } from "@kb/docs";
import { graphExtension } from "@kb/graph";
import { labExtension } from "@kb/lab";
import { locationsExtension } from "@kb/locations";
import { extensionNodeId, foldSeed, type KbNode, type NodeId } from "@kb/model";
import { coreExtension } from "@kb/operations";
import { outlineExtension } from "@kb/outline";
import { derivedWith, type DerivedRef } from "@kb/query";

/**
 * Every bundled family, in the order the registry loads them. The order is
 * data a fresh store keeps: it orders the families' view types under
 * `sys.views`, after core's.
 */
export const BUNDLED_FAMILIES: readonly ExtensionDeclaration[] = [
  outlineExtension,
  collectionsExtension,
  graphExtension,
  docsExtension,
  canvasExtension,
  labExtension,
  checkExtension,
  codeExtension,
  chartExtension,
  locationsExtension,
];

/**
 * The families a host composes beside the registry rather than in it: the
 * agent, which `kb ui` alone hosts (`cli/src/host-plugins.ts`, whose test
 * holds it to this list). Their code is that host's, but their seed is the
 * fold's, so every store holds the nodes their settings are written with,
 * whichever process opens it.
 */
export const HOSTED_FAMILIES: readonly ExtensionDeclaration[] = [agentExtension];

/** Core's declaration first, then each bundled family's, then each hosted one's: what the seed folds. */
export const BUNDLED_DECLARATIONS: readonly ExtensionDeclaration[] = [
  coreExtension,
  ...BUNDLED_FAMILIES,
  ...HOSTED_FAMILIES,
];

/**
 * The seed a store is opened with: the bundled declarations folded in order.
 * Pure data — it opens nothing and no registry is consulted, so every surface
 * seeds the same nodes whatever it loads. Stamped at `at`, else now.
 */
export function bundledSeed(at?: string): KbNode[] {
  return foldSeed(BUNDLED_DECLARATIONS, at).nodes;
}

/**
 * Who owns each node of that seed: the name of the declaration whose seed
 * holds its id (DESIGN.md → Extension families → ownership). The same fold
 * read the other way, so it cannot name a node the seed does not hold.
 */
export function bundledOwners(): ReadonlyMap<NodeId, string> {
  return foldSeed(BUNDLED_DECLARATIONS).owners;
}

/**
 * The derived ref attributes an index over `declarations`' fold derives:
 * the core ones, with the reference relation also fed by each field a
 * declaration says carries references (`refCarriers`), and each node the
 * fold seeds owned by its declaration's node under `sys.extensions`
 * (`:node/owner`). Pure data, like the fold.
 */
export function derivedOf(declarations: readonly ExtensionDeclaration[]): readonly DerivedRef[] {
  const { owners } = foldSeed(declarations);
  return derivedWith({
    fields: declarations.flatMap((declaration) => declaration.refCarriers ?? []),
    owners: new Map([...owners].map(([id, owner]) => [id, extensionNodeId(owner)] as const)),
  });
}

/**
 * The derived ref attributes every index a host builds derives: those of
 * the bundled fold, so the server's index and the page's answer References
 * and ownership alike.
 */
export function bundledDerived(): readonly DerivedRef[] {
  return derivedOf(BUNDLED_DECLARATIONS);
}
