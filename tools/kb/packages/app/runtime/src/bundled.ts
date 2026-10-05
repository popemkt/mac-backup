/**
 * The server's entries for the bundled families (DESIGN.md → Extension
 * families). Which families are bundled, and in what order, is
 * `BUNDLED_FAMILIES` in `@kb/bundled`; this file only says which plugin the
 * server loads for each, matched by the name every entry takes from its
 * declaration. It is the server's composition root for extensions, the one
 * file of this package that may import an extension package
 * (`EXTENSION_ROOTS` in `harness/src/constraints.ts`), and the registry
 * loads each one the store has on.
 *
 * The `extensionContract` suite (`@kb/test-kit`) runs over the resolved
 * list, so a family that joins it is held to the same promises as the rest.
 */
import { BUNDLED_FAMILIES } from "@kb/bundled";
import type { ExtensionDeclaration, ExtensionEntry } from "@kb/contracts";
import type { Plugin } from "@kb/plugin";
import { chartServerPlugin } from "@kb/chart-vega";
import { codePlugin } from "@kb/code";
import { canvasServerPlugin } from "@kb/ext-canvas";
import { checkPlugin } from "@kb/ext-check";
import { docsPlugin } from "@kb/ext-docs";
import { labPlugin } from "@kb/lab";

/**
 * Each declaration paired with the entry of the same name, in the
 * declarations' order. A family with no entry, or an entry that names no
 * family, is a bundling defect no store can repair, so it throws.
 */
export function serverEntriesFor(
  declarations: readonly ExtensionDeclaration[],
  entries: readonly Plugin[],
): readonly ExtensionEntry[] {
  const unmatched = new Map(entries.map((entry) => [entry.name, entry]));
  const paired = declarations.map((declaration) => {
    const entry = unmatched.get(declaration.name);
    if (entry === undefined) {
      throw new Error(`bundled family ${declaration.name} has no server entry`);
    }
    unmatched.delete(declaration.name);
    return { declaration, entry };
  });
  if (unmatched.size > 0) {
    throw new Error(`server entries ${[...unmatched.keys()].join(", ")} name no bundled family`);
  }
  return paired;
}

export const BUNDLED_EXTENSIONS: readonly ExtensionEntry[] = serverEntriesFor(BUNDLED_FAMILIES, [
  docsPlugin,
  canvasServerPlugin,
  labPlugin(),
  checkPlugin,
  codePlugin(),
  chartServerPlugin,
]);
