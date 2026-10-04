/**
 * The canvas family's seed: the `#canvas` tag and the field a canvas node
 * keeps its document in, which the tag templates, declared the way core
 * declares its own tags and fields. The bundled seed folds it after core's
 * nodes (DESIGN.md → Extension families → the seed is the bundled fold).
 */
import { seededField, seededTag, type KbNode } from "@kb/model";
import { CANVAS_IDS } from "./ids.ts";

export function canvasSeedNodes(at: string): readonly KbNode[] {
  return [
    seededField(CANVAS_IDS.canvasField, "canvas", "text", at, { one: true }),
    seededTag(CANVAS_IDS.canvasTag, "canvas", [CANVAS_IDS.canvasField], at),
  ];
}
