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
 * What a preset is placed with, chosen before it is placed: a card, the node
 * it shows. Picking such a tool opens its chooser instead of arming it, and
 * the choice places the item.
 */
export type CanvasChooser = "node";

const CHOOSERS: { readonly [P in CanvasPresetKind]?: CanvasChooser } = { "kb-node": "node" };

/** The chooser `pick` opens, or null for a tool that is armed. */
function chooserOf(pick: CanvasToolPick): CanvasChooser | null {
  return pick === "select" || pick === "solid" ? null : (CHOOSERS[pick] ?? null);
}

/**
 * Pick `pick` from a key or a button, sticky (a double-click) or not: a tool
 * placed with something chosen first opens its chooser, with select armed,
 * and is never sticky (its double-click's first click chose already); any
 * other is armed. Every way of picking a tool goes through here.
 */
export function pickTool(
  pick: CanvasToolPick,
  sticky: boolean,
  to: {
    readonly setToolState: (next: (state: ToolState) => ToolState) => void;
    readonly choose: (chooser: CanvasChooser) => void;
  },
): void {
  const chooser = chooserOf(pick);
  if (chooser !== null) {
    if (sticky) return;
    to.setToolState(() => ({ tool: "select" }));
    to.choose(chooser);
    return;
  }
  // Select places nothing, so it has nothing to repeat.
  const repeats = sticky && pick !== "select";
  to.setToolState((state) =>
    reduceCanvasTool(state, { type: repeats ? "set-tool-sticky" : "set-tool", tool: pick }),
  );
}

/**
 * Whether a press with `tool` places its preset: every tool but select, and
 * those placed with something chosen first (`chooserOf`).
 */
export function placesItem(tool: CanvasTool): boolean {
  return tool !== "select" && chooserOf(tool) === null;
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
  if (tool === "select" || !placesItem(tool)) return null;
  const node = presetItem(tool, world, id);
  return { doc: placeItems(doc, [node]), node, nextTool: "select" };
}
