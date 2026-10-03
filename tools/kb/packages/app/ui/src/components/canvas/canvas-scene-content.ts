import type { CanvasDoc } from "@kb/canvas";
import type { CanvasSelection } from "./canvas-selection";
import type { OutlineNode } from "@/sdk";

/** What the 3D canvas draws: the document, the store its cards read, and the shared selection. */
export interface CanvasSceneContent {
  readonly doc: CanvasDoc;
  readonly nodes: ReadonlyMap<string, OutlineNode>;
  readonly selection: CanvasSelection;
}
