/**
 * Canvas tool strip state + placement (pure — unit-tested). Every placing
 * tool is a preset (`CANVAS_PRESETS`, `@kb/canvas`): the tool makes its
 * preset's item at the point placed, written through `upsertCanvasNode`.
 */
import {
  presetItem,
  upsertCanvasNode,
  type CanvasDoc,
  type CanvasNode,
  type CanvasPresetKind,
} from "@kb/canvas";

/** Select, or a tool that places its preset. */
export type CanvasTool = "select" | CanvasPresetKind;

export interface ToolState {
  tool: CanvasTool;
  sticky?: boolean;
}

export type ToolAction =
  | { type: "set-tool"; tool: CanvasTool }
  | { type: "set-tool-sticky"; tool: CanvasTool }
  | { type: "escape" }
  | { type: "placed" };

export function reduceCanvasTool(state: ToolState, action: ToolAction): ToolState {
  if (action.type === "escape") return { tool: "select" };
  if (action.type === "placed") {
    return state.sticky === true ? state : { tool: "select" };
  }
  if (action.type === "set-tool-sticky") {
    return { tool: action.tool, sticky: true };
  }
  return { tool: action.tool };
}

/**
 * Place the active tool's preset at world coords. Returns null for select,
 * and for the card, whose node comes from the picker (it is placed with one).
 */
export function placeWithTool(
  doc: CanvasDoc,
  tool: CanvasTool,
  world: { x: number; y: number },
  id: string,
): { doc: CanvasDoc; node: CanvasNode; nextTool: CanvasTool } | null {
  if (tool === "select" || tool === "kb-node") return null;
  const node = presetItem(tool, world, id);
  return { doc: upsertCanvasNode(doc, node), node, nextTool: "select" };
}
