import type { CanvasDoc } from "@kb/canvas";
import type { CanvasSelection } from "@/lib/canvas-selection";
import type { OutlineNode } from "@/lib/types";

/** What the 3D canvas draws: the document, the store its cards read, and the shared selection. */
export interface CanvasSceneContent {
  readonly doc: CanvasDoc;
  readonly nodes: ReadonlyMap<string, OutlineNode>;
  readonly selection: CanvasSelection;
}
