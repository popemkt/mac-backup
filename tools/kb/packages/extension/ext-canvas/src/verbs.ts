/**
 * The relational verbs an agent edits a canvas with (plan 2026-10-02,
 * decision 16; DESIGN.md → Canvas documents): describe it, lint it, place
 * items by relation, lay them out, connect, group and ungroup them, and
 * promote a text card to a node. Each is an ordinary registry action, so
 * every surface lists it and the invoke core decides its approval; each
 * resolves its relation with `@kb/canvas`'s pure verbs — the code a
 * person's gestures go through — and each write is one canvas write
 * (`commitCanvasEffect`), so it is one step of an open canvas's history
 * and its receipt carries the lints it made and cleared.
 */
import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { z } from "zod";
import { KbCtx, Screens, type ExtensionAction, type KbStore } from "@kb/contracts";
import { nodeAddEffect } from "@kb/operations";
import { freshId, resolveFieldId, type KbNode } from "@kb/model";
import {
  CANVAS_DIRECTIONS,
  CANVAS_LAYOUTS,
  CANVAS_PRESET_KINDS,
  GRID_STEP,
  CanvasRelationError,
  arrangeItems,
  canvasMembership,
  connectItems,
  describeCanvas,
  groupItems,
  isGroupNode,
  itemBounds,
  itemKind,
  lintCanvas,
  makeItem,
  placeItem,
  promotableText,
  promoteItem,
  ungroupItems,
  type CanvasDoc,
  type CanvasLayerValue,
  type CanvasNode,
  type CanvasEdge,
  type CanvasWhere,
} from "@kb/canvas";
import { LintDiffSchema, LintSchema } from "./lints.ts";
import {
  CanvasTxError,
  canvasStep,
  commitCanvasEffect,
  readCanvasEffect,
  withPropOps,
  type CanvasFail,
  type CanvasWrite,
} from "./write.ts";

type WriteEnv = KbCtx | KbStore | FileSystem;

const CanvasIdSchema = z.string().min(1).describe("the #canvas node whose document this acts on");
const Vec = z.object({ x: z.number(), y: z.number(), z: z.number() });
const Bounds = z.object({ min: Vec, max: Vec });
const Direction = z
  .enum(CANVAS_DIRECTIONS)
  .describe(
    "along the canvas's own axes, never the camera's: left/right along x, north/south along y " +
      "(north is up the page in 2D), above/below up off the floor",
  );

/** An item as a write reports it: what it is and the box it now takes up. */
const PlacedSchema = z.object({
  id: z.string(),
  kind: z.string(),
  box: Bounds,
  frame: z.string().optional(),
});

/** Each of `ids` as `doc` now holds it. */
function placedOf(doc: CanvasDoc, ids: readonly string[]): z.infer<typeof PlacedSchema>[] {
  const membership = canvasMembership(doc.nodes);
  return ids.flatMap((id) => {
    const item = doc.nodes.find((node) => node.id === id);
    if (item === undefined) return [];
    const frame = membership.parentOf(id);
    return [
      {
        id,
        kind: itemKind(item),
        box: itemBounds(item),
        ...(frame === null ? {} : { frame }),
      },
    ];
  });
}

/** The ids of `ids` that are not items of `doc`, refused in one message. */
function requireItems(doc: CanvasDoc, ids: readonly string[]): void {
  const missing = ids.filter((id) => !doc.nodes.some((node) => node.id === id));
  if (missing.length > 0) {
    throw new CanvasRelationError(`no item ${missing.join(", ")} on this canvas`);
  }
}

// ── describe ────────────────────────────────────────────────────────────

const describeInput = z.object({
  canvasId: CanvasIdSchema,
  focus: z
    .array(z.string())
    .optional()
    .describe("item ids to describe in full; else the open tab's selection, else what it shows"),
  tab: z.string().min(1).optional().describe("the UI tab whose screen sets the detail"),
});

const DescribedItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  words: z.string(),
  box: Bounds,
  detail: z.enum(["focus", "blurry"]),
  nodeId: z.string().optional(),
  frame: z.string().optional(),
  rotation: z.object({ x: z.number(), y: z.number(), z: z.number() }).partial().optional(),
  faces: z.literal("camera").optional(),
});

const RelationSchema = z.union([
  z.object({ kind: z.enum(["on", "in"]), from: z.string(), to: z.string() }),
  z.object({
    kind: z.literal("linked"),
    from: z.string(),
    to: z.string(),
    edge: z.string(),
    label: z.string().optional(),
    field: z.string().optional(),
  }),
  z.object({
    kind: z.literal("near"),
    from: z.string(),
    to: z.string(),
    side: Direction,
    gap: z.number(),
  }),
]);

const ScreenSchema = z.object({
  tab: z.string(),
  pane: z.string(),
  projection: z.enum(["2d", "3d"]),
  pose: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
    zoom: z.number(),
    yaw: z.number(),
    pitch: z.number(),
    fov: z.number(),
  }),
  selection: z.array(z.string()),
  visible: z.array(z.string()),
});

const describeOutput = z.object({
  canvasId: z.string(),
  items: z.array(DescribedItemSchema),
  relations: z.array(RelationSchema),
  peripheral: z.array(
    z.object({
      frame: z.string().nullable(),
      count: z.number(),
      kinds: z.record(z.string(), z.number()),
    }),
  ),
  lints: z.array(LintSchema).readonly(),
  camera: z.record(z.string(), z.unknown()).optional(),
  screen: ScreenSchema.nullable(),
});

/**
 * The open tab showing `canvasId`, most recently active first: its pane's
 * selection, camera and what that camera shows. Null when no tab shows it
 * or the screen cannot be reached — a description needs no screen.
 */
const canvasScreenEffect = Effect.fn("ext.canvas.screen")(function* (
  canvasId: string,
  tab: string | undefined,
) {
  const screens = yield* Screens;
  const { tabs } = yield* screens.screen({ tab }).pipe(Effect.orElseSucceed(() => ({ tabs: [] })));
  for (const shown of tabs) {
    const panes = shown.panes.toSorted(
      (a, b) => Number(b.id === shown.activePane) - Number(a.id === shown.activePane),
    );
    for (const pane of panes) {
      if (pane.view?.subject !== canvasId || pane.canvas === undefined) continue;
      return {
        tab: shown.tab,
        pane: pane.id,
        projection: pane.canvas.projection,
        pose: pane.canvas.pose,
        selection: pane.selection,
        visible: pane.canvas.visible,
      };
    }
  }
  return null;
});

const canvasDescribeEffect = Effect.fn("ext.canvas.describe")(function* (
  input: z.infer<typeof describeInput>,
): Effect.fn.Return<z.infer<typeof describeOutput>, CanvasFail, KbCtx | Screens> {
  const ctx = yield* KbCtx;
  const doc = yield* readCanvasEffect(input.canvasId);
  const screen = yield* canvasScreenEffect(input.canvasId, input.tab);
  const texts = new Map(ctx.nodes.map((node) => [node.id, node.text]));
  const chosen =
    input.focus ?? (screen !== null && screen.selection.length > 0 ? screen.selection : null);
  const visible = screen === null ? undefined : new Set(screen.visible);
  const focus = chosen === null ? visible : new Set(chosen);
  const told = describeCanvas(doc, {
    nodeText: (id) => texts.get(id),
    ...(focus === undefined ? {} : { focus }),
    ...(visible === undefined ? {} : { visible }),
  });
  return {
    canvasId: input.canvasId,
    items: told.items.map((item) => ({ ...item })),
    relations: [...told.relations],
    peripheral: told.peripheral.map((cluster) => ({ ...cluster })),
    lints: told.lints,
    ...(told.camera === undefined ? {} : { camera: { ...told.camera } }),
    screen,
  };
});

// ── lint ────────────────────────────────────────────────────────────────

const lintInput = z.object({ canvasId: CanvasIdSchema });
const lintOutput = z.object({ canvasId: z.string(), lints: z.array(LintSchema).readonly() });

const canvasLintEffect = Effect.fn("ext.canvas.lint")(function* (
  input: z.infer<typeof lintInput>,
): Effect.fn.Return<z.infer<typeof lintOutput>, CanvasFail, KbCtx> {
  const ctx = yield* KbCtx;
  const doc = yield* readCanvasEffect(input.canvasId);
  const known = new Set(ctx.nodes.map((node) => node.id));
  const lints = lintCanvas(doc, (id) => known.has(id));
  return { canvasId: input.canvasId, lints };
});

// ── place ───────────────────────────────────────────────────────────────

const MakeSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .optional()
      .describe("the new item's id, so a later placement can name it"),
    preset: z
      .enum(CANVAS_PRESET_KINDS)
      .optional()
      .describe("what to make; a text card when absent"),
    text: z
      .string()
      .optional()
      .describe("its words: a text card's text, a shape's or frame's label"),
    color: z.string().optional(),
    nodeId: z.string().optional().describe("the node it stands for (a card needs one)"),
    file: z.string().optional().describe("an image's asset path, assets/…"),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    depth: z.number().min(0).optional().describe("how far it rises off its base; 0 is flat"),
  })
  .describe("a new item");

const PlacementSchema = z
  .object({
    make: MakeSchema.optional(),
    move: z
      .string()
      .min(1)
      .optional()
      .describe("an item already on the canvas, moved with its members"),
    near: z.string().optional().describe("place beside this item, on `side` of it"),
    side: Direction.optional(),
    gap: z
      .number()
      .min(0)
      .optional()
      .describe("room between the two; a grid step (20) when absent"),
    on: z.string().optional().describe("place on top of this item (a frame: in it)"),
    in: z.string().optional().describe("place inside this frame, clear of its other members"),
    at: z
      .object({ x: z.number(), y: z.number(), z: z.number().optional() })
      .optional()
      .describe(
        "plain coordinates of its top left; with no z it keeps its height, or stands on what is under it",
      ),
  })
  .superRefine((p, ctx) => {
    if ((p.make === undefined) === (p.move === undefined)) {
      ctx.addIssue({ code: "custom", message: "give exactly one of make or move" });
    }
    const relations = [p.near, p.on, p.in, p.at].filter((r) => r !== undefined).length;
    if (relations !== 1) {
      ctx.addIssue({ code: "custom", message: "give exactly one of near, on, in or at" });
    }
    if ((p.near === undefined) !== (p.side === undefined)) {
      ctx.addIssue({ code: "custom", message: "near takes a side, and a side needs near" });
    }
  });

const placeInput = z.object({
  canvasId: CanvasIdSchema,
  items: z
    .array(PlacementSchema)
    .min(1)
    .describe("placed in order; a later one may name an earlier one"),
});
const placeOutput = z.object({
  canvasId: z.string(),
  placed: z.array(PlacedSchema),
  lints: LintDiffSchema,
});

type Placement = z.infer<typeof PlacementSchema>;

/** The relation a placement names, as `placeItem` takes it. */
function whereOf(p: Placement): CanvasWhere {
  if (p.near !== undefined && p.side !== undefined) {
    return { near: p.near, side: p.side, ...(p.gap === undefined ? {} : { gap: p.gap }) };
  }
  if (p.on !== undefined) return { on: p.on };
  if (p.in !== undefined) return { in: p.in };
  if (p.at !== undefined) return { at: p.at };
  throw new CanvasRelationError("give exactly one of near, on, in or at");
}

/** The item a placement places: a new one made from its spec, or one already on the canvas. */
function itemOf(doc: CanvasDoc, p: Placement, id: string): CanvasNode {
  if (p.move !== undefined) {
    requireItems(doc, [p.move]);
    return doc.nodes.find((node) => node.id === p.move) ?? makeItem({ preset: "text" }, id);
  }
  const make = p.make ?? {};
  if (doc.nodes.some((node) => node.id === id)) {
    throw new CanvasRelationError(`an item ${id} is already on this canvas`);
  }
  const { id: _given, preset, ...spec } = make;
  return makeItem({ ...spec, preset: preset ?? "text" }, id);
}

const canvasPlaceEffect = Effect.fn("ext.canvas.place")(function* (
  input: z.infer<typeof placeInput>,
): Effect.fn.Return<z.infer<typeof placeOutput>, CanvasFail, WriteEnv> {
  let doc = yield* readCanvasEffect(input.canvasId);
  const ids: string[] = [];
  for (const p of input.items) {
    const id = p.move ?? p.make?.id ?? (yield* freshId);
    const placed = yield* canvasStep(() => placeItem(doc, itemOf(doc, p, id), whereOf(p)));
    doc = placed.doc;
    ids.push(id);
  }
  const written = yield* commitCanvasEffect({ canvasId: input.canvasId, doc });
  return { canvasId: input.canvasId, placed: placedOf(doc, ids), lints: written.lints };
});

// ── arrange ─────────────────────────────────────────────────────────────

const arrangeInput = z
  .object({
    canvasId: CanvasIdSchema,
    ids: z.array(z.string()).min(1).describe("the items, in the order laid out"),
    layout: z
      .enum(CANVAS_LAYOUTS)
      .describe(
        "row, column, grid, ring, stack (each on the one before), or layers (height by a field's value)",
      ),
    gap: z.number().min(0).optional().describe("room between neighbours, or between layers"),
    columns: z.number().int().positive().optional().describe("a grid's items per row"),
    field: z
      .string()
      .optional()
      .describe("layers: the field whose value on each item's node sets its layer"),
  })
  .refine((input) => input.layout !== "layers" || input.field !== undefined, {
    message: "layers take the field their values come from",
  });
const arrangeOutput = z.object({
  canvasId: z.string(),
  arranged: z.array(PlacedSchema),
  lints: LintDiffSchema,
});

/** What a node's first value of `fieldId` orders a layer by: a number, else its words. */
function layerValue(
  nodes: ReadonlyMap<string, KbNode>,
  nodeId: string | undefined,
  fieldId: string,
): CanvasLayerValue | undefined {
  const value = nodeId === undefined ? undefined : nodes.get(nodeId)?.props[fieldId]?.[0];
  if (value === undefined) return undefined;
  if (value.t === "num") return value.v;
  if (value.t === "ref") return nodes.get(value.v)?.text ?? value.v;
  return String(value.v);
}

const canvasArrangeEffect = Effect.fn("ext.canvas.arrange")(function* (
  input: z.infer<typeof arrangeInput>,
): Effect.fn.Return<z.infer<typeof arrangeOutput>, CanvasFail, WriteEnv> {
  const ctx = yield* KbCtx;
  const before = yield* readCanvasEffect(input.canvasId);
  const field = input.field;
  const fieldId =
    field === undefined ? undefined : yield* canvasStep(() => resolveFieldId(ctx.nodes, field));
  const nodes = new Map(ctx.nodes.map((node) => [node.id, node]));
  const doc = yield* canvasStep(() => {
    requireItems(before, input.ids);
    return arrangeItems(before, input.ids, {
      layout: input.layout,
      ...(input.gap === undefined ? {} : { gap: input.gap }),
      ...(input.columns === undefined ? {} : { columns: input.columns }),
      ...(fieldId === undefined
        ? {}
        : { layerOf: (item: CanvasNode) => layerValue(nodes, item.nodeId, fieldId) }),
    });
  });
  const written = yield* commitCanvasEffect({ canvasId: input.canvasId, doc });
  return { canvasId: input.canvasId, arranged: placedOf(doc, input.ids), lints: written.lints };
});

// ── connect ─────────────────────────────────────────────────────────────

const connectInput = z.object({
  canvasId: CanvasIdSchema,
  from: z.string().min(1).describe("the item the arrow leaves"),
  to: z.string().min(1).describe("the item it points at"),
  label: z.string().optional(),
  bind: z
    .string()
    .optional()
    .describe("a ref field (name or id): also set it on from's node, pointing at to's node, once"),
});
const connectOutput = z.object({
  canvasId: z.string(),
  edge: z.string(),
  bound: z.string().optional(),
  lints: LintDiffSchema,
});

/**
 * The source node a bound edge sets its ref on, written beside the edge;
 * nothing when the edge binds nothing or the source already holds the ref
 * (a bind is one-shot, as the edge inspector's is).
 */
function bindWrite(
  nodes: KbNode[],
  edge: CanvasEdge,
  fieldId: string | undefined,
): Pick<CanvasWrite, "also"> {
  const link = edge.kbLink;
  if (fieldId === undefined || link === undefined) return {};
  const source = nodes.find((node) => node.id === link.sourceNodeId);
  const held = (source?.props[fieldId] ?? []).some(
    (value) => value.t === "ref" && value.v === link.targetNodeId,
  );
  if (held) return {};
  const set = [{ field: fieldId, value: { t: "ref" as const, v: link.targetNodeId } }];
  return {
    also: (at) => [withPropOps(nodes, link.sourceNodeId, { set }, at)],
  };
}

const canvasConnectEffect = Effect.fn("ext.canvas.connect")(function* (
  input: z.infer<typeof connectInput>,
): Effect.fn.Return<z.infer<typeof connectOutput>, CanvasFail, WriteEnv> {
  const ctx = yield* KbCtx;
  const before = yield* readCanvasEffect(input.canvasId);
  const bind = input.bind;
  const fieldId =
    bind === undefined ? undefined : yield* canvasStep(() => resolveFieldId(ctx.nodes, bind));
  const id = yield* freshId;
  const bindingId = yield* freshId;
  const { doc, edge } = yield* canvasStep(() =>
    connectItems(before, {
      id,
      bindingId,
      from: input.from,
      to: input.to,
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(fieldId === undefined ? {} : { bindField: fieldId }),
    }),
  );
  const written = yield* commitCanvasEffect({
    canvasId: input.canvasId,
    doc,
    ...bindWrite(ctx.nodes, edge, fieldId),
  });
  return {
    canvasId: input.canvasId,
    edge: edge.id,
    ...(fieldId === undefined ? {} : { bound: fieldId }),
    lints: written.lints,
  };
});

// ── group / ungroup ─────────────────────────────────────────────────────

const groupInput = z.object({
  canvasId: CanvasIdSchema,
  ids: z.array(z.string()).min(1).describe("the items gathered into a new frame round them"),
  label: z.string().optional(),
});
const groupOutput = z.object({ canvasId: z.string(), group: PlacedSchema, lints: LintDiffSchema });

const canvasGroupEffect = Effect.fn("ext.canvas.group")(function* (
  input: z.infer<typeof groupInput>,
): Effect.fn.Return<z.infer<typeof groupOutput>, CanvasFail, WriteEnv> {
  const before = yield* readCanvasEffect(input.canvasId);
  const id = yield* freshId;
  const doc = yield* canvasStep(() => {
    requireItems(before, input.ids);
    // A grid step round them, as ⌘G gathers them.
    const grouped = groupItems(before, input.ids, id, GRID_STEP);
    const label = input.label;
    if (label === undefined) return grouped;
    return {
      ...grouped,
      nodes: grouped.nodes.map((node) =>
        node.id === id && isGroupNode(node) ? { ...node, label } : node,
      ),
    };
  });
  const [group] = placedOf(doc, [id]);
  if (group === undefined) return yield* Effect.fail(new CanvasTxError("nothing to group"));
  const written = yield* commitCanvasEffect({ canvasId: input.canvasId, doc });
  return { canvasId: input.canvasId, group, lints: written.lints };
});

const ungroupInput = z.object({
  canvasId: CanvasIdSchema,
  ids: z.array(z.string()).min(1).describe("frames taken apart; their members stay where they are"),
});
const ungroupOutput = z.object({
  canvasId: z.string(),
  released: z.array(z.string()),
  lints: LintDiffSchema,
});

const canvasUngroupEffect = Effect.fn("ext.canvas.ungroup")(function* (
  input: z.infer<typeof ungroupInput>,
): Effect.fn.Return<z.infer<typeof ungroupOutput>, CanvasFail, WriteEnv> {
  const before = yield* readCanvasEffect(input.canvasId);
  const { doc, released } = yield* canvasStep(() => {
    requireItems(before, input.ids);
    const notFrames = input.ids.filter(
      (id) => !before.nodes.some((n) => n.id === id && isGroupNode(n)),
    );
    if (notFrames.length > 0) {
      throw new CanvasRelationError(`${notFrames.join(", ")} is not a frame to take apart`);
    }
    return ungroupItems(before, input.ids);
  });
  const written = yield* commitCanvasEffect({ canvasId: input.canvasId, doc });
  return { canvasId: input.canvasId, released: [...released], lints: written.lints };
});

// ── promote ─────────────────────────────────────────────────────────────

const promoteInput = z.object({
  canvasId: CanvasIdSchema,
  id: z.string().min(1).describe("a text card whose words become a node it then shows"),
  nodeId: z.string().min(1).optional().describe("the new node's id; minted when absent"),
});
const promoteOutput = z.object({
  canvasId: z.string(),
  id: z.string(),
  nodeId: z.string(),
  lints: LintDiffSchema,
});

const canvasPromoteEffect = Effect.fn("ext.canvas.promote")(function* (
  input: z.infer<typeof promoteInput>,
): Effect.fn.Return<z.infer<typeof promoteOutput>, CanvasFail, WriteEnv> {
  const before = yield* readCanvasEffect(input.canvasId);
  const text = yield* canvasStep(() => promotableText(before, input.id));
  // Node first, then layout (D6): an orphan node is harmless, a card of no node is not.
  const { id: nodeId } = yield* nodeAddEffect({
    text,
    ...(input.nodeId === undefined ? {} : { id: input.nodeId }),
  });
  const doc = yield* canvasStep(() => promoteItem(before, input.id, nodeId));
  const written = yield* commitCanvasEffect({ canvasId: input.canvasId, doc });
  return { canvasId: input.canvasId, id: input.id, nodeId, lints: written.lints };
});

/** The verbs as the canvas family contributes them, ids local to `ext.canvas`. */
export const CANVAS_VERBS: ExtensionAction[] = [
  {
    id: "describe",
    title: "Describe a canvas",
    description:
      "Say what is on a canvas for an agent that cannot see it: each item's kind, words and box " +
      "(min/max along x right, y down the page, z up), and how items stand: on, in a frame, linked, " +
      "and near by a side in plain words (left, right, north, south, above, below — the canvas's own " +
      "axes). Items in focus are in full, the rest on screen blurred, what is off screen counted per " +
      "frame; with no focus and no open tab every item is in full. Also its lints and camera.",
    mode: { kind: "read" },
    inputSchema: describeInput,
    outputSchema: describeOutput,
    effect: canvasDescribeEffect,
  },
  {
    id: "lint",
    title: "Lint a canvas",
    description:
      "What is probably a mistake on a canvas: overlap (two items in the same room, one a solid), " +
      "floating (raised with nothing under it), missing-end (an edge to an item not there), " +
      "missing-node, missing-group, outside-frame. Every canvas write also answers {new, resolved}.",
    mode: { kind: "read" },
    inputSchema: lintInput,
    outputSchema: lintOutput,
    effect: canvasLintEffect,
  },
  {
    id: "place",
    title: "Place items",
    description:
      "Make or move items by relation, never by working out coordinates: near another on a side " +
      "(left, right, north, south, above, below) with a gap, on top of another, in a frame, or at " +
      "plain coordinates. Positions are resolved and snapped as a drag lands; a taken spot steps " +
      "further out by the grid until clear. Placed in order in one write (one undo step).",
    mode: { kind: "write" },
    inputSchema: placeInput,
    outputSchema: placeOutput,
    effect: canvasPlaceEffect,
  },
  {
    id: "arrange",
    title: "Arrange items",
    description:
      "Lay items out as a row, column, grid, ring or stack, or as layers whose height follows a " +
      "field's value on each item's node. A frame's members move with it. One write (one undo step).",
    mode: { kind: "write" },
    inputSchema: arrangeInput,
    outputSchema: arrangeOutput,
    effect: canvasArrangeEffect,
  },
  {
    id: "connect",
    title: "Connect two items",
    description:
      "Draw an arrow from one item to another, between the sides facing each other. With `bind`, " +
      "also set that ref field on the from item's node to the to item's node, once (both must stand " +
      "for nodes).",
    mode: { kind: "write" },
    inputSchema: connectInput,
    outputSchema: connectOutput,
    effect: canvasConnectEffect,
  },
  {
    id: "group",
    title: "Group items",
    description: "Gather items into a new frame a grid step round them; they become its members.",
    mode: { kind: "write" },
    inputSchema: groupInput,
    outputSchema: groupOutput,
    effect: canvasGroupEffect,
  },
  {
    id: "ungroup",
    title: "Ungroup frames",
    description:
      "Take frames apart; their members stay where they are and belong where the frame did.",
    mode: { kind: "write" },
    inputSchema: ungroupInput,
    outputSchema: ungroupOutput,
    effect: canvasUngroupEffect,
  },
  {
    id: "promote",
    title: "Promote to node",
    description:
      "Make a node of a text card's words (no parent) and turn the card into a card of that node, " +
      "its box, colour and frame kept.",
    mode: { kind: "write" },
    inputSchema: promoteInput,
    outputSchema: promoteOutput,
    effect: canvasPromoteEffect,
  },
];
