/**
 * The canvas family's declaration and its shared plugin (DESIGN.md →
 * Extension families). The declaration is the one home of the family's
 * name, seed and views; the bundled seed folds it, and both hosts' entries
 * load {@link canvasPlugin}, so the keys and the seed cannot differ between
 * them. The server's entry (`@kb/ext-canvas`) adds the family's actions, and
 * the page's adds its surfaces. A canvas says itself in the generic text, so
 * its views carry no text of their own. It is optional and on by default.
 */
import { declarationPlugin, defineExtension, viewDef } from "@kb/contracts";
import type { Plugin } from "@kb/plugin";
import { canvasSeedNodes } from "./seed.ts";
import { CanvasListView, CanvasView } from "./view.ts";

export const canvasExtension = defineExtension({
  name: "canvas",
  label: "Canvas",
  optional: { byDefault: "on" },
  seed: canvasSeedNodes,
  views: [viewDef(CanvasListView), viewDef(CanvasView)],
});

/**
 * The canvas family's shared plugin: its declaration's views. Each host's
 * entry loads it as a child.
 */
export function canvasPlugin(): Plugin {
  return declarationPlugin(canvasExtension);
}
