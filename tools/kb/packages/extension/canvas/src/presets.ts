/**
 * The predefined objects: each one a preset over the one item record, never
 * a kind of its own (plan 2026-10-02 decision 5). A preset is the partial
 * item a tool makes; placing it gives it an id, a place and, for a card, the
 * node it shows. A tool makes the same item in either projection, and so
 * does anything else that places one.
 */
import type {
  CanvasGroupNode,
  CanvasKbNode,
  CanvasNode,
  CanvasShapeNode,
  CanvasTextNode,
} from "./doc.ts";

/** An item before it is placed: no id, no position, and no meaning yet. */
type Unplaced<N extends CanvasNode> = Omit<N, "id" | "x" | "y" | "nodeId">;

const CANVAS_PRESETS = {
  /** A text card: its own words, no node. */
  text: { type: "text", text: "", width: 220, height: 80 } satisfies Unplaced<CanvasTextNode>,
  rect: {
    type: "shape",
    shape: "rect",
    width: 160,
    height: 100,
  } satisfies Unplaced<CanvasShapeNode>,
  ellipse: {
    type: "shape",
    shape: "ellipse",
    width: 160,
    height: 100,
  } satisfies Unplaced<CanvasShapeNode>,
  diamond: {
    type: "shape",
    shape: "diamond",
    width: 160,
    height: 100,
  } satisfies Unplaced<CanvasShapeNode>,
  /** A frame. */
  group: { type: "group", width: 300, height: 200 } satisfies Unplaced<CanvasGroupNode>,
  /** A card: a text card showing a node, so it is placed with one. */
  "kb-node": { type: "kb-node", width: 280, height: 72 } satisfies Unplaced<CanvasKbNode>,
} as const;

export type CanvasPresetKind = keyof typeof CANVAS_PRESETS;

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
