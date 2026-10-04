/**
 * The predefined objects: each one a preset over the one item record, never
 * a kind of its own (plan 2026-10-02 decision 5). A preset is the partial
 * item a tool makes; placing it gives it an id, a place and, for a card, the
 * node it shows. A tool makes the same item in either projection, and so
 * does anything else that places one.
 *
 * A solid is nothing but a preset with depth: a box is a rectangle that
 * rises, a pillar a tall ellipse, a slab a thin rectangle raised off the
 * floor, a wall a thin rectangle standing on its long edge. Extruding any
 * flat item makes the same kind of thing.
 */
import type {
  CanvasFileNode,
  CanvasGroupNode,
  CanvasKbNode,
  CanvasNode,
  CanvasShapeNode,
  CanvasTextNode,
} from "./doc.ts";

/** An item before it is placed: no id, no position, and no meaning yet. */
type Unplaced<N extends CanvasNode> = N extends unknown
  ? Omit<N, "id" | "x" | "y" | "nodeId">
  : never;

const shape = (
  kind: CanvasShapeNode["shape"],
  size: Pick<CanvasShapeNode, "width" | "height" | "depth" | "z">,
): Unplaced<CanvasShapeNode> => ({ type: "shape", shape: kind, ...size });

const CANVAS_PRESETS = {
  /** A text card: its own words, no node. */
  text: { type: "text", text: "", width: 220, height: 80 } satisfies Unplaced<CanvasTextNode>,
  rect: shape("rect", { width: 160, height: 100 }),
  ellipse: shape("ellipse", { width: 160, height: 100 }),
  diamond: shape("diamond", { width: 160, height: 100 }),
  /** A frame. */
  group: { type: "group", width: 300, height: 200 } satisfies Unplaced<CanvasGroupNode>,
  /** A card: a text card showing a node, so it is placed with one. */
  "kb-node": { type: "kb-node", width: 280, height: 72 } satisfies Unplaced<CanvasKbNode>,
  /** A picture: a file item showing an image asset, so it is placed with one (`imageItem`). */
  image: { type: "file", file: "", width: 320, height: 240 } satisfies Unplaced<CanvasFileNode>,
  box: shape("rect", { width: 120, height: 120, depth: 120 }),
  pillar: shape("ellipse", { width: 72, height: 72, depth: 220 }),
  sphere: shape("sphere", { width: 140, height: 140, depth: 140 }),
  cone: shape("cone", { width: 120, height: 120, depth: 150 }),
  /** A shelf: a thin board raised off the floor, to stand things on. */
  slab: shape("rect", { width: 260, height: 96, depth: 14, z: 120 }),
  /** A board standing on its long edge, facing the front. */
  wall: shape("rect", { width: 320, height: 20, depth: 200 }),
} as const satisfies Record<string, Unplaced<CanvasNode>>;

export type CanvasPresetKind = keyof typeof CANVAS_PRESETS;

function isPresetKind(key: string): key is CanvasPresetKind {
  return key in CANVAS_PRESETS;
}

const PRESET_KINDS = Object.keys(CANVAS_PRESETS).filter(isPresetKind);

/** Whether `preset` makes a solid: an item with depth. */
function makesSolid(preset: CanvasPresetKind): boolean {
  const item: Unplaced<CanvasNode> = CANVAS_PRESETS[preset];
  return (item.depth ?? 0) > 0;
}

/** The presets that make solids, in the table's order: what the solid tool picks among. */
export const CANVAS_SOLID_PRESETS: readonly CanvasPresetKind[] = PRESET_KINDS.filter(makesSolid);

/**
 * `preset` placed with its top left at `at`, as item `id`; `nodeId` is what
 * it means, which a card needs and any other item may have.
 */
export function presetItem(
  preset: CanvasPresetKind,
  at: { readonly x: number; readonly y: number },
  id: string,
  nodeId?: string,
): CanvasNode {
  return {
    ...CANVAS_PRESETS[preset],
    id,
    x: at.x,
    y: at.y,
    ...(nodeId === undefined ? {} : { nodeId }),
  };
}

/**
 * The image preset placed showing asset `file` (`assets/…`), centred on
 * `at`: at its own aspect when its pixel size `natural` is known, never
 * larger than it and its longer side no longer than the preset's.
 */
export function imageItem(
  file: string,
  at: { readonly x: number; readonly y: number },
  id: string,
  natural?: { readonly width: number; readonly height: number },
): CanvasFileNode {
  const preset = CANVAS_PRESETS.image;
  const bound = Math.max(preset.width, preset.height);
  const known = natural !== undefined && natural.width > 0 && natural.height > 0;
  const scale = known ? Math.min(1, bound / Math.max(natural.width, natural.height)) : 1;
  const width = known ? Math.max(1, Math.round(natural.width * scale)) : preset.width;
  const height = known ? Math.max(1, Math.round(natural.height * scale)) : preset.height;
  return { ...preset, id, file, x: at.x - width / 2, y: at.y - height / 2, width, height };
}
