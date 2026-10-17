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
import type { CanvasFrame, CanvasVec } from "./box.ts";
import {
  canvasDepth,
  canvasElevation,
  isGroupNode,
  isPathNode,
  isShapeNode,
  isTextNode,
  withDepth,
  withElevation,
  withLink,
  withRotation,
  type CanvasFileNode,
  type CanvasGroupNode,
  type CanvasItemLink,
  type CanvasKbNode,
  type CanvasNode,
  type CanvasPathNode,
  type CanvasShapeNode,
  type CanvasTextNode,
} from "./doc.ts";
import { withLine, type CanvasLinePatch } from "./paths.ts";
import { CanvasRelationError } from "./relations.ts";
import { apply, rotationOfMatrix } from "./rotation.ts";
import { canvasColor, withStyle, type CanvasLooksPatch } from "./style.ts";

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
  /** A label: a text card that faces the camera in 3D, readable from any side. */
  label: {
    type: "text",
    text: "",
    width: 160,
    height: 48,
    billboard: true,
  } satisfies Unplaced<CanvasTextNode>,
  rect: shape("rect", { width: 160, height: 100 }),
  ellipse: shape("ellipse", { width: 160, height: 100 }),
  diamond: shape("diamond", { width: 160, height: 100 }),
  triangle: shape("triangle", { width: 160, height: 140 }),
  hexagon: shape("hexagon", { width: 160, height: 120 }),
  star: shape("star", { width: 160, height: 152 }),
  cloud: shape("cloud", { width: 200, height: 130 }),
  "arrow-left": shape("arrow-left", { width: 180, height: 100 }),
  "arrow-right": shape("arrow-right", { width: 180, height: 100 }),
  "arrow-up": shape("arrow-up", { width: 100, height: 180 }),
  "arrow-down": shape("arrow-down", { width: 100, height: 180 }),
  "check-box": shape("check-box", { width: 100, height: 100 }),
  /** A frame. */
  group: { type: "group", width: 300, height: 200 } satisfies Unplaced<CanvasGroupNode>,
  /** A card: a text card showing a node, so it is placed with one. */
  "kb-node": { type: "kb-node", width: 280, height: 72 } satisfies Unplaced<CanvasKbNode>,
  /** A line across its box, left to right; it turns and stretches as its box does. */
  line: {
    type: "path",
    points: [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ],
    width: 200,
    height: 24,
  } satisfies Unplaced<CanvasPathNode>,
  /** An arrow free of any item: a line whose far end wears an arrowhead. */
  arrow: {
    type: "path",
    points: [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ],
    toHead: "arrow",
    width: 200,
    height: 24,
  } satisfies Unplaced<CanvasPathNode>,
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

/** The presets that make flat shapes, in the table's order: what the shape tool picks among. */
export const CANVAS_SHAPE_PRESETS: readonly CanvasPresetKind[] = PRESET_KINDS.filter(
  (preset) => CANVAS_PRESETS[preset].type === "shape" && !makesSolid(preset),
);

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

/** Every preset, in the table's order: what a placement may name. */
export const CANVAS_PRESET_KINDS: readonly CanvasPresetKind[] = PRESET_KINDS;

/**
 * What a new item is asked for in words, as an agent asks: a preset, the
 * words it shows (a text card's text, a shape's or a frame's label), and
 * any of its look and size. A card needs the node it shows, a picture the
 * asset it shows. A colour may be named ("red") or written as JSON Canvas
 * writes one ("1", a hex); its looks are `style.ts`'s. A line or an arrow
 * may be given its points and heads (`line`).
 */
export interface CanvasItemSpec {
  readonly preset: CanvasPresetKind;
  readonly text?: string;
  readonly line?: CanvasLinePatch;
  readonly color?: string;
  readonly style?: CanvasLooksPatch;
  readonly nodeId?: string;
  readonly link?: CanvasItemLink;
  readonly file?: string;
  readonly width?: number;
  readonly height?: number;
  readonly depth?: number;
}

/**
 * The item `spec` asks for, as item `id`, not yet placed (its top left at
 * the origin, its preset's elevation). Throws `CanvasRelationError` when a
 * card names no node or a picture no asset.
 */
export function makeItem(spec: CanvasItemSpec, id: string): CanvasNode {
  const origin = { x: 0, y: 0 };
  if (spec.preset === "kb-node" && (spec.nodeId ?? "") === "") {
    throw new CanvasRelationError("a card shows a node: give its nodeId");
  }
  if (spec.preset === "image" && (spec.file ?? "") === "") {
    throw new CanvasRelationError("a picture shows an asset: give its file (assets/…)");
  }
  const base =
    spec.preset === "image"
      ? imageItem(spec.file ?? "", origin, id)
      : presetItem(spec.preset, origin, id, spec.nodeId);
  const sized = {
    ...base,
    x: 0,
    y: 0,
    ...(spec.width === undefined ? {} : { width: Math.max(1, spec.width) }),
    ...(spec.height === undefined ? {} : { height: Math.max(1, spec.height) }),
    ...(spec.color === undefined ? {} : { color: canvasColor(spec.color) }),
    ...(spec.nodeId === undefined ? {} : { nodeId: spec.nodeId }),
  };
  const linked = withLink(sized, spec.link);
  const lined = spec.line === undefined ? linked : lineOf(linked, spec.line, spec.preset);
  const styled = spec.style === undefined ? lined : withStyle(lined, spec.style);
  const deep = spec.depth === undefined ? styled : withDepth(styled, spec.depth);
  if (spec.text === undefined) return deep;
  if (isTextNode(deep)) return { ...deep, text: spec.text };
  if (isShapeNode(deep) || isGroupNode(deep)) return { ...deep, label: spec.text };
  throw new CanvasRelationError(`a ${spec.preset} shows no words of its own`);
}

/** `item` drawn as the line `patch` says; throws for an item that is no line. */
function lineOf(item: CanvasNode, patch: CanvasLinePatch, preset: CanvasPresetKind): CanvasNode {
  if (!isPathNode(item))
    throw new CanvasRelationError(`a ${preset} is no line: it takes no points`);
  return withLine(item, patch);
}

/** How far off a face an item placed on it stands, canvas units: clear of it, so the two never fight. */
const OFF_FACE = 1;

/**
 * `item` placed on the plane of `face` — a frame's face, wherever it stands
 * — its top left at `at` on that plane: turned as the face is, and its base
 * lifted off the face by its own elevation (a shelf stands off a wall as it
 * stands off the floor) and a hair more. The floor needs none of that:
 * `presetItem` places there.
 */
export function placedOnFace<N extends CanvasNode>(item: N, face: CanvasFrame, at: CanvasVec): N {
  const depth = canvasDepth(item);
  const lift = canvasElevation(item) + depth / 2 + OFF_FACE;
  const centre = apply(face.matrix, { x: item.width / 2, y: item.height / 2, z: lift });
  const placed = {
    ...item,
    x: at.x + centre.x - item.width / 2,
    y: at.y + centre.y - item.height / 2,
  };
  return withRotation(
    withElevation(placed, at.z + centre.z - depth / 2),
    rotationOfMatrix(face.matrix),
  );
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
