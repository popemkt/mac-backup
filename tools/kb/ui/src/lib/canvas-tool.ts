/**
 * Canvas tool strip state + placement (pure — unit-tested).
 * Shape/text placement is JSON-only via upsertCanvasNode.
 */
import {
  upsertCanvasNode,
  type CanvasDoc,
  type CanvasNode,
  type CanvasShapeKind,
  type CanvasShapeNode,
  type CanvasTextNode,
} from "@kb/canvas";

export type CanvasTool =
  | "select"
  | "text"
  | "rect"
  | "ellipse"
  | "diamond"
  | "kb-node";

export const DEFAULT_SHAPE_SIZE = { width: 160, height: 100 } as const;
export const DEFAULT_TEXT_SIZE = { width: 220, height: 80 } as const;

export interface ToolState {
  tool: CanvasTool;
}

export type ToolAction =
  | { type: "set-tool"; tool: CanvasTool }
  | { type: "escape" }
  | { type: "placed" };

export function reduceCanvasTool(state: ToolState, action: ToolAction): ToolState {
  if (action.type === "escape" || action.type === "placed") {
    return { tool: "select" };
  }
  return { tool: action.tool };
}

export function createShapeNode(
  kind: CanvasShapeKind,
  x: number,
  y: number,
  id: string,
): CanvasShapeNode {
  return {
    id,
    type: "shape",
    shape: kind,
    x,
    y,
    width: DEFAULT_SHAPE_SIZE.width,
    height: DEFAULT_SHAPE_SIZE.height,
  };
}

export function isShapeTool(
  tool: CanvasTool,
): tool is "rect" | "ellipse" | "diamond" {
  return tool === "rect" || tool === "ellipse" || tool === "diamond";
}

/**
 * Place a node for the active tool at world coords.
 * Returns null for select / kb-node (picker path). Reverts tool to select.
 */
export function placeWithTool(
  doc: CanvasDoc,
  tool: CanvasTool,
  world: { x: number; y: number },
  id: string,
): { doc: CanvasDoc; node: CanvasNode; nextTool: CanvasTool } | null {
  if (tool === "select" || tool === "kb-node") return null;

  if (tool === "text") {
    const node: CanvasTextNode = {
      id,
      type: "text",
      text: "",
      x: world.x,
      y: world.y,
      ...DEFAULT_TEXT_SIZE,
    };
    return {
      doc: upsertCanvasNode(doc, node),
      node,
      nextTool: "select",
    };
  }

  if (!isShapeTool(tool)) return null;

  const node = createShapeNode(tool, world.x, world.y, id);
  return {
    doc: upsertCanvasNode(doc, node),
    node,
    nextTool: "select",
  };
}
