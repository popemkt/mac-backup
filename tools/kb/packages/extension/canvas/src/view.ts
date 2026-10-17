/**
 * The canvas's views: every canvas, and one canvas. Their params come from
 * the route, so a view node stores none; this module is their vocabulary.
 */
import { Schema } from "effect";
import { DATA_EVENT } from "@kb/sandbox";
import { NoParams, viewKey } from "@kb/views";

/** The namespace of the canvas views' ids: what draws them, the canvas family. */
const CANVAS_NAMESPACE = "canvas";

export const CanvasParams = Schema.Struct({
  /** The `#canvas` node's id. */
  id: Schema.String,
  /** An item on it to show and select as it opens: where a link to it leads. */
  item: Schema.optional(Schema.String),
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

/**
 * What a canvas tells the scripts run for it (DESIGN.md → Sandbox →
 * Scripts), each a `kb/event` type:
 * - `canvas.selection`: the items and edges now selected
 *   (`value: {canvas, items, edges}`);
 * - `canvas.change`: its document changed (`value: {canvas, lints}`, the
 *   lints the change made and cleared);
 * - `canvas.item.click`: an item was pressed (`target` its id,
 *   `value: {canvas}`);
 * - `canvas.page`: the page shown changed (`target` the page's node,
 *   `value: {board}`).
 */
export const CANVAS_EVENTS = {
  selection: "canvas.selection",
  change: "canvas.change",
  itemClick: "canvas.item.click",
  page: "canvas.page",
} as const;

/** One canvas, which owns its own viewport; its scripts hear its events and the graph changing. */
export const CanvasView = viewKey(`${CANVAS_NAMESPACE}.page`, "Canvas", CanvasParams, undefined, {
  events: [...Object.values(CANVAS_EVENTS), DATA_EVENT],
});
