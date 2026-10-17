/**
 * The canvas's views: every canvas, and one canvas. One canvas is shown for
 * its `#canvas` node, and its view node holds how it is looked at, the
 * camera (`./camera.ts`); every canvas reads no settings. This module is
 * their vocabulary.
 */
import { Schema } from "effect";
import { hostViewIds, viewOptionOf, type KbNode, type NodeId } from "@kb/model";
import { DATA_EVENT } from "@kb/sandbox";
import { NoParams, viewKey } from "@kb/views";
import { canvasCameraProps, readCanvasCamera } from "./camera.ts";

/** The namespace of the canvas views' ids: what draws them, the canvas family. */
const CANVAS_NAMESPACE = "canvas";

const CanvasPose = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  z: Schema.Finite,
  zoom: Schema.Finite.check(Schema.isGreaterThan(0)),
  yaw: Schema.Finite,
  pitch: Schema.Finite,
  fov: Schema.optional(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 179 }))),
});

export const CanvasParams = Schema.Struct({
  /** The `#canvas` node's id: the node the view is shown for. */
  id: Schema.String,
  /** An item on it to show and select as it opens: where a link to it leads. */
  item: Schema.optional(Schema.String),
  /** The projection it opens in; absent is 2D. */
  projection: Schema.optional(Schema.Literals(["2d", "3d"])),
  /** The 3D pose it was last looked at from. */
  pose: Schema.optional(CanvasPose),
}).annotate({
  description:
    "One canvas, shown for its #canvas node (`id`, from the node it is shown for or the route; `item`, from the route). Its view node holds the camera: the projection it opens in and the 3D pose it was last looked at from.",
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

/**
 * One canvas, looked at through its view node's camera; its scripts hear
 * its events and the graph changing. The canvas is the node the view is
 * shown for, and the item to open at is the route's, so neither is stored.
 */
export const CanvasView = viewKey(
  `${CANVAS_NAMESPACE}.page`,
  "Canvas",
  CanvasParams,
  {
    read: (props, host, report) => ({
      ...(host === null ? {} : { id: host }),
      ...readCanvasCamera(props, report),
    }),
    write: ({ projection, pose }) =>
      canvasCameraProps(
        projection === undefined
          ? undefined
          : { projection, ...(pose === undefined ? {} : { pose }) },
      ),
  },
  { events: [...Object.values(CANVAS_EVENTS), DATA_EVENT] },
);

/**
 * The view node a canvas is looked at through when no view node is named
 * (its `/canvas/<id>` page, an agent's look): the first of its views that
 * is a canvas view, or null when it names none. `lookup` reads a node.
 */
export function canvasViewIdOf(
  canvas: Pick<KbNode, "props"> | undefined,
  lookup: (id: NodeId) => Pick<KbNode, "props"> | undefined,
): NodeId | null {
  return hostViewIds(canvas).find((id) => viewOptionOf(lookup(id)) === CanvasView.option) ?? null;
}
