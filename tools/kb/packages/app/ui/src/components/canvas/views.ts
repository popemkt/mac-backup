import { viewKey, type NoParams } from "@/lib/plugins";

/** The canvas plugin's namespace and view keys: what a host imports, never the components. */
export const CANVAS_NAMESPACE = "canvas";

export interface CanvasParams {
  /** The `#canvas` node's id. */
  readonly id: string;
}

/** Every canvas in the workspace. */
export const CanvasListView = viewKey<NoParams>()(`${CANVAS_NAMESPACE}.list`);

/** One canvas, which owns its own viewport. */
export const CanvasView = viewKey<CanvasParams>()(`${CANVAS_NAMESPACE}.page`);
