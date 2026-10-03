/**
 * The families the server bundles (DESIGN.md → Extension families): each
 * one's declaration, and the server entry built from it. This file is the
 * server's composition root for extensions: it is the one file of this
 * package that may import an extension package (`EXTENSION_ROOTS` in
 * `harness/src/constraints.ts`), and the registry loads what it lists.
 *
 * The `extensionContract` suite (`@kb/test-kit`) runs over this list, so a
 * family that joins it is held to the same promises as the rest.
 */
import type { ExtensionDeclaration } from "@kb/contracts";
import type { Plugin } from "@kb/plugin";
import { canvasExtension } from "@kb/canvas";
import { canvasPlugin } from "@kb/ext-canvas";
import { checkExtension, checkPlugin } from "@kb/ext-check";
import { docsExtension, docsPlugin } from "@kb/ext-docs";

/** One bundled family: the declaration that names it, and the plugin the server loads for it. */
export interface BundledExtension {
  readonly declaration: ExtensionDeclaration;
  readonly entry: Plugin;
}

// Named apart from the browser's list: GAP [[01M41H30N0SV4QE5R8VQQ1K4ZA]]
export const BUNDLED_EXTENSIONS: readonly BundledExtension[] = [
  { declaration: docsExtension, entry: docsPlugin },
  { declaration: canvasExtension, entry: canvasPlugin },
  { declaration: checkExtension, entry: checkPlugin },
];
