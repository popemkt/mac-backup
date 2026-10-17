/**
 * Canvas tool strip state + placement (pure — unit-tested). Every placing
 * tool is a preset (`CANVAS_PRESETS`, `@kb/canvas`): the tool makes its
 * preset's item at the point placed (`placeItems`), which belongs to the
 * frame it lands in.
 *
 * A family of tools shares one button, tldraw's geo-tool pattern
 * (`TOOL_FAMILIES`): picking one of its tools remembers it, and picking the
 * family picks the one last picked — the solids' (B) the solid last made. The
 * comment tool (M) places a comment thread rather than an item: on the item
 * it is pressed on, or at the point.
 */
import {
  CANVAS_SOLID_PRESETS,
  isGroupNode,
  placeItems,
  placedOnFace,
  presetItem,
  type CanvasDoc,
  type CanvasFrame,
  type CanvasNode,
  type CanvasPresetKind,
  type CommentPlace,
} from "@kb/canvas";
import type { CanvasPlace } from "./canvas-faces";

/** Select, the hand (a press pans), the comment tool, or a tool that places its preset. */
export type CanvasTool = "select" | "hand" | "comment" | CanvasPresetKind;

/** The tools that share one button and one pick, each family's in its picker's order. */
export const TOOL_FAMILIES = {
  solid: CANVAS_SOLID_PRESETS,
} as const satisfies Readonly<Record<string, readonly CanvasPresetKind[]>>;

export type CanvasToolFamily = keyof typeof TOOL_FAMILIES;

/** What a key or a button picks: a tool, or a family (whichever of its tools was picked last). */
export type CanvasToolPick = CanvasTool | CanvasToolFamily;

export interface ToolState {
  tool: CanvasTool;
  sticky?: boolean;
  /** Each family's tool last picked, which picking the family picks again; absent, its first. */
  picked?: Partial<Readonly<Record<CanvasToolFamily, CanvasPresetKind>>>;
}

export type ToolAction =
  | { type: "set-tool"; tool: CanvasToolPick }
  | { type: "set-tool-sticky"; tool: CanvasToolPick }
  | { type: "escape" }
  | { type: "used" };

/** Whether `pick` names a family rather than a tool. */
function isFamily(pick: CanvasToolPick): pick is CanvasToolFamily {
  return Object.hasOwn(TOOL_FAMILIES, pick);
}

/** Whether `tool` places a preset, rather than taking hold of what is there. */
function isPresetTool(tool: CanvasToolPick): tool is CanvasPresetKind {
  return tool !== "select" && tool !== "hand" && tool !== "comment" && !isFamily(tool);
}

/** Whether a press pans, whatever it lands on: Space is held, or the hand tool is armed. */
export function pressPans(state: ToolState, spaceHeld: boolean): boolean {
  return spaceHeld || state.tool === "hand";
}

/** The family `tool` belongs to, or null for a tool with a button of its own. */
export function familyOf(tool: CanvasTool): CanvasToolFamily | null {
  const families = Object.keys(TOOL_FAMILIES).filter((key): key is CanvasToolFamily =>
    Object.hasOwn(TOOL_FAMILIES, key),
  );
  return families.find((family) => TOOL_FAMILIES[family].some((one) => one === tool)) ?? null;
}

/** The tool picking `family` picks in `state`: the one last picked, or its first (select, were it empty). */
export function lastOf(state: ToolState, family: CanvasToolFamily): CanvasTool {
  return state.picked?.[family] ?? TOOL_FAMILIES[family][0] ?? "select";
}

/** What `state` remembers once `tool` is picked: it, as its family's last, when it has one. */
function remembered(state: ToolState, tool: CanvasTool): ToolState["picked"] {
  const family = isPresetTool(tool) ? familyOf(tool) : null;
  if (family === null || !isPresetTool(tool)) return state.picked;
  return { ...state.picked, ...Object.fromEntries([[family, tool]]) };
}

/** `state` with `pick` active (a family's last tool for a family), remembering it in its family. */
function activate(state: ToolState, pick: CanvasToolPick, sticky: boolean): ToolState {
  const tool = isFamily(pick) ? lastOf(state, pick) : pick;
  const picked = remembered(state, tool);
  return {
    tool,
    ...(sticky ? { sticky: true } : {}),
    ...(picked === undefined ? {} : { picked }),
  };
}

export function reduceCanvasTool(state: ToolState, action: ToolAction): ToolState {
  if (action.type === "escape") return activate(state, "select", false);
  if (action.type === "used") {
    return state.sticky === true ? state : activate(state, "select", false);
  }
  if (action.type === "set-tool-sticky") return activate(state, action.tool, true);
  return activate(state, action.tool, false);
}

/**
 * What a preset is placed with, chosen before it is placed: a card, the node
 * it shows; an image, its picture file. Picking such a tool opens its chooser
 * instead of arming it, and the choice places the item.
 */
export type CanvasChooser = "node" | "file";

const CHOOSERS: { readonly [P in CanvasPresetKind]?: CanvasChooser } = {
  "kb-node": "node",
  image: "file",
};

/** The chooser `pick` opens, or null for a tool that is armed. */
function chooserOf(pick: CanvasToolPick): CanvasChooser | null {
  return isPresetTool(pick) ? (CHOOSERS[pick] ?? null) : null;
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
  // Select and the hand place nothing, so they have nothing to repeat.
  const repeats = sticky && pick !== "select" && pick !== "hand";
  to.setToolState((state) =>
    reduceCanvasTool(state, { type: repeats ? "set-tool-sticky" : "set-tool", tool: pick }),
  );
}

/**
 * Whether a press with `tool` places its preset: every tool but select, and
 * those placed with something chosen first (`chooserOf`).
 */
export function placesItem(tool: CanvasTool): boolean {
  return isPresetTool(tool) && chooserOf(tool) === null;
}

/**
 * Place the active tool's preset with its top left at `world` — on the
 * floor, or on `face` (a frame's that stands: `placeUnder`), turned as it
 * is; null when the tool places nothing on a press (`placesItem`).
 */
export function placeWithTool(
  doc: CanvasDoc,
  tool: CanvasTool,
  world: { readonly x: number; readonly y: number; readonly z?: number },
  id: string,
  face: CanvasFrame | null = null,
): { doc: CanvasDoc; node: CanvasNode; nextTool: CanvasTool } | null {
  if (!isPresetTool(tool) || !placesItem(tool)) return null;
  const preset = presetItem(tool, world, id);
  const node =
    face === null
      ? preset
      : placedOnFace(preset, face, { x: world.x, y: world.y, z: world.z ?? 0 });
  return { doc: placeItems(doc, [node]), node, nextTool: "select" };
}

/**
 * Where a press with a tool lands, in whichever projection saw it: the
 * place under it (on the face of a frame it was pressed on, or the floor;
 * null when the eye's ray meets neither), and the item it was pressed on
 * when the tool takes that item's press (`toolTakes`); null on empty canvas.
 */
export interface ToolSpot {
  readonly place: CanvasPlace | null;
  readonly item: CanvasNode | null;
}

/**
 * Whether a press with `tool` on `item` is the tool's rather than the
 * item's: a placing tool places on a frame it is pressed on, not into it;
 * the comment tool comments on whatever it is pressed on.
 */
export function toolTakes(tool: CanvasTool, item: CanvasNode): boolean {
  return tool === "comment" || (placesItem(tool) && isGroupNode(item));
}

/**
 * What a press with a tool does where it lands: the item it placed, in the
 * document it placed it in; or where a comment it starts goes (`commentWrite`).
 */
export type ToolPress =
  | { readonly kind: "place"; readonly doc: CanvasDoc; readonly node: CanvasNode }
  | { readonly kind: "comment"; readonly place: CommentPlace };

/**
 * What a press with `tool` at `spot` does, `id` naming anything it makes;
 * null when the tool does nothing there, so the press means what it would
 * with select. Every press with an armed tool goes through here.
 */
export function pressWithTool(
  doc: CanvasDoc,
  tool: CanvasTool,
  spot: ToolSpot,
  id: string,
): ToolPress | null {
  if (tool === "comment") {
    if (spot.item !== null) return { kind: "comment", place: { on: spot.item.id } };
    if (spot.place === null) return null;
    return { kind: "comment", place: { at: { x: spot.place.at.x, y: spot.place.at.y } } };
  }
  if (spot.place === null) return null;
  const placed = placeWithTool(doc, tool, spot.place.at, id, spot.place.face);
  return placed === null ? null : { kind: "place", doc: placed.doc, node: placed.node };
}
