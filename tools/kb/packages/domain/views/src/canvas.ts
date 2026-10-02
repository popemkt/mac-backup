import { Schema } from "effect";
import { NoParams, viewKey } from "./view-key.ts";

/** The canvas plugin's namespace and view keys: what a host imports, never the components. */
export const CANVAS_NAMESPACE = "canvas";

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
  NoParams.annotate({ description: "Every canvas in the workspace. It reads no settings." }),
);

/** One canvas, which owns its own viewport. */
export const CanvasView = viewKey(`${CANVAS_NAMESPACE}.page`, CanvasParams);
