/**
 * The canvas's views: every canvas, and one canvas. Their params come from
 * the route, so a view node stores none; this module is their vocabulary.
 */
import { Schema } from "effect";
import { NoParams, viewKey } from "@kb/views";

/** The namespace of the canvas views' ids: what draws them, the canvas family. */
const CANVAS_NAMESPACE = "canvas";

export const CanvasParams = Schema.Struct({
  /** The `#canvas` node's id. */
  id: Schema.String,
}).annotate({
  description:
    "One canvas, which owns its own viewport. Its params come from the route: a view node holds none.",
});
export type CanvasParams = typeof CanvasParams.Type;

/** Every canvas in the workspace. */
export const CanvasListView = viewKey(
  `${CANVAS_NAMESPACE}.list`,
  "Canvases",
  NoParams.annotate({ description: "Every canvas in the workspace. It reads no settings." }),
);

/** One canvas, which owns its own viewport. */
export const CanvasView = viewKey(`${CANVAS_NAMESPACE}.page`, "Canvas", CanvasParams);
