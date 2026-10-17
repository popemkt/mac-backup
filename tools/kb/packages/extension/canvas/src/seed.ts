/**
 * The canvas family's seed, declared the way core declares its own tags and
 * fields: the `#canvas` tag and the field a canvas node keeps its document
 * in; the canvas view node's camera settings, the projection an option
 * field whose options are its children and the pose; and `#comment` (`./comments.ts`) with the fields that pin a comment on
 * a canvas and the option field that says whether its thread is resolved,
 * its options its children. The bundled seed folds it after core's nodes
 * (DESIGN.md → Extension families → the seed is the bundled fold).
 */
import { SYSTEM_IDS, seededField, seededTag, type KbNode } from "@kb/model";
import { CANVAS_IDS } from "./ids.ts";

const ref = (v: string) => [{ t: "ref" as const, v }];

/** An option of a seeded option field: a plain node, the field's child. */
function option(id: string, text: string, at: string): KbNode {
  return { id, text, props: {}, children: [], createdAt: at, updatedAt: at };
}

export function canvasSeedNodes(at: string): readonly KbNode[] {
  const state = seededField(CANVAS_IDS.commentStateField, "comment.state", "ref", at, {
    one: true,
  });
  const projection = seededField(CANVAS_IDS.canvasProjectionField, "canvas.projection", "ref", at, {
    one: true,
  });
  return [
    seededField(CANVAS_IDS.canvasField, "canvas", "text", at, { one: true }),
    seededTag(CANVAS_IDS.canvasTag, "canvas", [CANVAS_IDS.canvasField], at),
    { ...projection, children: [CANVAS_IDS.canvasProjection2d, CANVAS_IDS.canvasProjection3d] },
    option(CANVAS_IDS.canvasProjection2d, "2d", at),
    option(CANVAS_IDS.canvasProjection3d, "3d", at),
    seededField(CANVAS_IDS.canvasPoseField, "canvas.pose", "text", at, { one: true }),
    seededField(CANVAS_IDS.commentCanvasField, "comment.canvas", "ref", at, {
      one: true,
      props: { [SYSTEM_IDS.targetTagField]: ref(CANVAS_IDS.canvasTag) },
    }),
    seededField(CANVAS_IDS.commentNodeField, "comment.node", "ref", at, { one: true }),
    seededField(CANVAS_IDS.commentItemField, "comment.item", "text", at, { one: true }),
    seededField(CANVAS_IDS.commentAtField, "comment.at", "text", at, { one: true }),
    { ...state, children: [CANVAS_IDS.commentOpen, CANVAS_IDS.commentResolved] },
    option(CANVAS_IDS.commentOpen, "open", at),
    option(CANVAS_IDS.commentResolved, "resolved", at),
    seededTag(
      CANVAS_IDS.commentTag,
      "comment",
      [
        CANVAS_IDS.commentCanvasField,
        CANVAS_IDS.commentNodeField,
        CANVAS_IDS.commentItemField,
        CANVAS_IDS.commentAtField,
        CANVAS_IDS.commentStateField,
      ],
      at,
    ),
  ];
}
