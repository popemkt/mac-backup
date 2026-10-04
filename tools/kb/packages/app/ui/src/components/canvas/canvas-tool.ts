/**
 * Canvas tool strip state + placement (pure — unit-tested). Every placing
 * tool is a preset (`CANVAS_PRESETS`, `@kb/canvas`): the tool makes its
 * preset's item at the point placed (`placeItems`), which belongs to the
 * frame it lands in.
 *
 * The solids share one tool, tldraw's geo-tool pattern: picking a solid
 * preset remembers it, and the solid tool (B) picks the one last made.
 */
import {
  CANVAS_SOLID_PRESETS,
  placeItems,
  presetItem,
  type CanvasDoc,
  type CanvasNode,
  type CanvasPresetKind,
} from "@kb/canvas";

/** Select, or a tool that places its preset. */
export type CanvasTool = "select" | CanvasPresetKind;

/** What a key or a button picks: a tool, or the solid tool (whichever solid it last made). */
export type CanvasToolPick = CanvasTool | "solid";

export interface ToolState {
  tool: CanvasTool;
  sticky?: boolean;
  /** The solid preset last picked, which the solid tool picks again; absent, the first. */
  solid?: CanvasPresetKind;
}

export type ToolAction =
  | { type: "set-tool"; tool: CanvasToolPick }
  | { type: "set-tool-sticky"; tool: CanvasToolPick }
  | { type: "escape" }
  | { type: "placed" };

/** Whether `tool` places a solid (a preset with depth). */
export function isSolidTool(tool: CanvasTool): tool is CanvasPresetKind {
  return CANVAS_SOLID_PRESETS.some((preset) => preset === tool);
}

/** The solid the solid tool picks in `state`: the last one picked, or the first. */
export function solidOf(state: ToolState): CanvasPresetKind {
  return state.solid ?? CANVAS_SOLID_PRESETS[0] ?? "box";
}

/** `state` with `pick` active (the solid tool's solid for "solid"), remembering a solid. */
function activate(state: ToolState, pick: CanvasToolPick, sticky: boolean): ToolState {
  const tool = pick === "solid" ? solidOf(state) : pick;
  const solid = isSolidTool(tool) ? tool : state.solid;
  return {
    tool,
    ...(sticky ? { sticky: true } : {}),
    ...(solid === undefined ? {} : { solid }),
  };
}

export function reduceCanvasTool(state: ToolState, action: ToolAction): ToolState {
  if (action.type === "escape") return activate(state, "select", false);
  if (action.type === "placed") {
    return state.sticky === true ? state : activate(state, "select", false);
  }
  if (action.type === "set-tool-sticky") return activate(state, action.tool, true);
  return activate(state, action.tool, false);
}

/**
 * Whether a press with `tool` places its preset: every tool but select, and
 * the card, whose node comes from the picker (it is placed with one).
 */
export function placesItem(tool: CanvasTool): tool is Exclude<CanvasTool, "select" | "kb-node"> {
  return tool !== "select" && tool !== "kb-node";
}

/**
 * Place the active tool's preset at world coords; null when the tool places
 * nothing on a press (`placesItem`).
 */
export function placeWithTool(
  doc: CanvasDoc,
  tool: CanvasTool,
  world: { x: number; y: number },
  id: string,
): { doc: CanvasDoc; node: CanvasNode; nextTool: CanvasTool } | null {
  if (!placesItem(tool)) return null;
  const node = presetItem(tool, world, id);
  return { doc: placeItems(doc, [node]), node, nextTool: "select" };
}
