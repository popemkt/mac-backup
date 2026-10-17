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
import { CoreInvoke, KbCtx, Screens, type ExtensionAction, type KbStore } from "@kb/contracts";
import { planNodeAddEffect } from "@kb/operations";
import { freshId, relationFieldFit, relationMisfit, resolveFieldId, type KbNode } from "@kb/model";
import {
  CANVAS_ALIGN_EDGES,
  CANVAS_LAYOUTS,
  CANVAS_ORDERS,
  CANVAS_PRESET_KINDS,
  CANVAS_SIDES,
  GRID_STEP,
  CanvasRelationError,
  arrangeItems,
  boardOf,
  canvasMembership,
  canvasWorld,
  connectItems,
  describeCanvas,
  flipItems,
  freeItems,
  groupItems,
  isGroupNode,
  itemBounds,
  itemKind,
  lintCanvas,
  makeItem,
  orderItems,
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
import { COMMENT_VERB } from "./comment.ts";
import { LintDiffSchema, LintSchema } from "./lints.ts";
import {
  AnchorSchema,
  Bounds,
  CanvasIdSchema,
  ColorSchema,
  CommentThreadSchema,
  DescribedItemSchema,
  LinkSchema,
  Direction,
  EdgeLooksSchema,
  headPatch,
  HeadSchema,
  LooksSchema,
  MAX_LINE_POINTS,
  RelationSchema,
  RouteSchema,
  ScreenSchema,
} from "./schemas.ts";
import {
  CanvasTxError,
  canvasStep,
  commitCanvasEffect,
  readableEffect,
  readableQueryEffect,
  readCanvasEffect,
  withPropOps,
  type CanvasFail,
  type CanvasWrite,
} from "./write.ts";

type WriteEnv = KbCtx | KbStore | FileSystem;

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
/** The items a verb changes: each on this canvas, and free to take (`freeItems`). */
function requireItems(doc: CanvasDoc, ids: readonly string[]): void {
  const missing = ids.filter((id) => !doc.nodes.some((node) => node.id === id));
  if (missing.length > 0) {
    throw new CanvasRelationError(`no item ${missing.join(", ")} on this canvas`);
  }
  const free = freeItems(doc.nodes, ids);
  const locked = ids.filter((id) => !free.has(id));
  if (locked.length > 0) {
    throw new CanvasRelationError(
      `${locked.join(", ")} is locked; unlock it (locked: false, through tx.apply) to change it`,
    );
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

const describeOutput = z.object({
  canvasId: z.string(),
  items: z.array(DescribedItemSchema),
  comments: z
    .array(CommentThreadSchema)
    .describe("the comment threads on the canvas: resolve one by setting its comment.state"),
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
  scripts: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe(
      "the scripts the board and this page name, as ext.code.script.list tells them (each with its grant and whether a person trusts it); absent while no family keeps scripts",
    ),
});

const scriptsSchema = z.object({ scripts: z.array(z.record(z.string(), z.unknown())) });

/** The action that lists the scripts nodes name, which the family that keeps scripts provides. */
const SCRIPT_LIST = "ext.code.script.list";

/**
 * The scripts that run on `canvasId` — its board's, then its own — as the
 * family that keeps scripts lists them, through the host's `CoreInvoke` as
 * a read; null while no such family answers (or the host has no invoke), so
 * a canvas needs no scripts to be described.
 */
const canvasScriptsEffect = Effect.fn("ext.canvas.scripts")(function* (
  canvasId: string,
  board: string,
) {
  const invoke = yield* CoreInvoke;
  if (invoke === null) return null;
  const subjects = board === canvasId ? [canvasId] : [board, canvasId];
  const receipt = yield* invoke({ id: SCRIPT_LIST, input: { subjects } }, "read");
  if (receipt.status === "failed") return null;
  const listed = scriptsSchema.safeParse(receipt.output);
  return listed.success ? listed.data.scripts : null;
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
  const doc = yield* readCanvasEffect(input.canvasId);
  const screen = yield* canvasScreenEffect(input.canvasId, input.tab);
  const chosen =
    input.focus ?? (screen !== null && screen.selection.length > 0 ? screen.selection : null);
  const visible = screen === null ? undefined : new Set(screen.visible);
  const focus = chosen === null ? visible : new Set(chosen);
  const world = canvasWorld(yield* readableEffect());
  const scripts = yield* canvasScriptsEffect(input.canvasId, boardOf(world, input.canvasId));
  const told = describeCanvas(doc, {
    canvasId: input.canvasId,
    world,
    ...(focus === undefined ? {} : { focus }),
    ...(visible === undefined ? {} : { visible }),
  });
  return {
    canvasId: input.canvasId,
    items: told.items.map((item) => ({ ...item })),
    comments: told.comments.map((thread) => ({
      ...thread,
      replies: [...thread.replies],
    })),
    relations: [...told.relations],
    peripheral: told.peripheral.map((cluster) => ({ ...cluster })),
    lints: told.lints,
    ...(told.camera === undefined ? {} : { camera: { ...told.camera } }),
    screen,
    ...(scripts === null ? {} : { scripts }),
  };
});

// ── lint ────────────────────────────────────────────────────────────────

const lintInput = z.object({ canvasId: CanvasIdSchema });
const lintOutput = z.object({ canvasId: z.string(), lints: z.array(LintSchema).readonly() });

const canvasLintEffect = Effect.fn("ext.canvas.lint")(function* (
  input: z.infer<typeof lintInput>,
): Effect.fn.Return<z.infer<typeof lintOutput>, CanvasFail, KbCtx> {
  const doc = yield* readCanvasEffect(input.canvasId);
  const lints = lintCanvas(input.canvasId, doc, canvasWorld(yield* readableEffect()));
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
    color: ColorSchema.optional(),
    style: LooksSchema.optional().describe("its looks beyond its colour"),
    line: z
      .object({
        points: z
          .array(AnchorSchema)
          .min(2)
          .max(MAX_LINE_POINTS)
          .optional()
          .describe("the points it runs through, in its box, in order; default left to right"),
        closed: z.boolean().optional().describe("its last point joins its first"),
        fromHead: HeadSchema.optional().describe("the head at its first point; default none"),
        toHead: HeadSchema.optional().describe("the head at its last point; an arrow's is arrow"),
      })
      .optional()
      .describe("a line's or an arrow's points and heads (preset line or arrow)"),
    nodeId: z.string().min(1).optional().describe("the node it stands for (a card needs one)"),
    link: LinkSchema.optional(),
    file: z.string().min(1).optional().describe("an image's asset path, assets/…"),
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
        "plain coordinates of the top left of its box; with no z it keeps its height, or stands on what is under it",
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
  const { id: _given, preset, line, ...spec } = make;
  const lined =
    line === undefined
      ? {}
      : {
          line: {
            ...(line.points === undefined ? {} : { points: line.points }),
            ...(line.closed === undefined ? {} : { closed: line.closed }),
            ...headPatch(line),
          },
        };
  return makeItem({ ...spec, ...lined, preset: preset ?? "text" }, id);
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
      .optional()
      .describe(
        "row, column, grid, ring, stack (each on the one before), layers (height by a field's " +
          "value), align (on an edge), or distribute (evenly along an axis)",
      ),
    order: z
      .enum(CANVAS_ORDERS)
      .optional()
      .describe(
        "instead of a layout: paint them in front of the rest, behind, or one step either way",
      ),
    flip: z
      .enum(["x", "y"])
      .optional()
      .describe("instead of a layout: mirror them, left for right (x) or top for bottom (y)"),
    gap: z.number().min(0).optional().describe("room between neighbours, or between layers"),
    columns: z.number().int().positive().optional().describe("a grid's items per row"),
    field: z
      .string()
      .optional()
      .describe("layers: the field whose value on each item's node sets its layer"),
    edge: z.enum(CANVAS_ALIGN_EDGES).optional().describe("align: the edge they line up on"),
    axis: z.enum(["x", "y"]).optional().describe("distribute: the axis they spread along"),
  })
  .refine(
    (input) =>
      [input.layout, input.order, input.flip].filter((act) => act !== undefined).length === 1,
    { message: "arrange takes one of a layout, an order or a flip" },
  )
  .refine(
    (input) =>
      input.layout !== undefined ||
      [input.gap, input.columns, input.field, input.edge, input.axis].every((p) => p === undefined),
    { message: "an order or a flip takes no layout's gap, columns, field, edge or axis" },
  )
  .refine((input) => input.layout !== "layers" || input.field !== undefined, {
    message: "layers take the field their values come from",
  })
  .refine((input) => input.layout !== "align" || input.edge !== undefined, {
    message: "align takes the edge to line up on",
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
  const { layout, order, flip } = input;
  const doc = yield* canvasStep(() => {
    requireItems(before, input.ids);
    if (order !== undefined) return orderItems(before, input.ids, order);
    if (flip !== undefined) return flipItems(before, input.ids, flip);
    return arrangeItems(before, input.ids, {
      layout: layout ?? "row",
      ...(input.gap === undefined ? {} : { gap: input.gap }),
      ...(input.columns === undefined ? {} : { columns: input.columns }),
      ...(input.edge === undefined ? {} : { edge: input.edge }),
      ...(input.axis === undefined ? {} : { axis: input.axis }),
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
  fromSide: z.enum(CANVAS_SIDES).optional().describe("the side it leaves by; else facing to"),
  toSide: z.enum(CANVAS_SIDES).optional().describe("the side it arrives by; else facing from"),
  fromAnchor: AnchorSchema.optional().describe("where it leaves, precisely; wins over fromSide"),
  toAnchor: AnchorSchema.optional().describe("where it arrives, precisely; wins over toSide"),
  route: RouteSchema.optional(),
  bend: z
    .number()
    .optional()
    .describe(
      "an arc's bow off the straight line, left of travel (negative: right), or how far an " +
        "elbow's middle run is moved; canvas units. Only an arc or an elbow takes one",
    ),
  fromHead: HeadSchema.optional().describe("the head where it leaves; default none"),
  toHead: HeadSchema.optional().describe("the head where it arrives; default arrow"),
  color: ColorSchema.optional(),
  style: EdgeLooksSchema.optional(),
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
/**
 * The field a bound edge sets, by name or id: one a relation to the node the
 * edge arrives at can be typed as, by the one rule every relation write and
 * the edge inspector's field menu read (`relationFieldFit`, `@kb/model`) — a
 * person's own ref field that allows the target, so kb's `sys.*` fields (a
 * node's tags among them) are never an edge's to set. The field, the target
 * and the target query are read as the call may read them (`readableEffect`,
 * `readableQueryEffect`), so a script learns nothing of a node beyond its
 * subject from what a bind is refused for. An arrival that stands for no
 * node is refused by `connectItems`.
 */
const bindableFieldEffect = Effect.fn("ext.canvas.connect.bind")(function* (
  field: string,
  target: string | undefined,
): Effect.fn.Return<string, CanvasFail, KbCtx> {
  const readable = yield* readableEffect();
  const runQuery = yield* readableQueryEffect();
  return yield* canvasStep(() => {
    const fieldId = resolveFieldId(readable, field);
    if (target === undefined) return fieldId;
    const byId = new Map(readable.map((node) => [node.id, node]));
    const fieldNode = byId.get(fieldId);
    const fit =
      fieldNode === undefined ? "not-field" : relationFieldFit(fieldNode, target, byId, runQuery);
    if (fit !== "fits") throw new CanvasRelationError(relationMisfit(fit, fieldId, target));
    return fieldId;
  });
});

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

/** Where a connection's ends meet their items and how it is drawn, as `connectItems` takes it. */
function connectionLook(input: z.infer<typeof connectInput>) {
  const { label, fromSide, toSide, fromAnchor, toAnchor, route, bend, color, style } = input;
  return {
    ...(label === undefined ? {} : { label }),
    ...(fromSide === undefined ? {} : { fromSide }),
    ...(toSide === undefined ? {} : { toSide }),
    ...(fromAnchor === undefined ? {} : { fromAnchor }),
    ...(toAnchor === undefined ? {} : { toAnchor }),
    ...(route === undefined ? {} : { route }),
    ...(bend === undefined ? {} : { bend }),
    ...headPatch(input),
    ...(color === undefined ? {} : { color }),
    ...(style === undefined ? {} : { style }),
  };
}

const canvasConnectEffect = Effect.fn("ext.canvas.connect")(function* (
  input: z.infer<typeof connectInput>,
): Effect.fn.Return<z.infer<typeof connectOutput>, CanvasFail, WriteEnv> {
  const ctx = yield* KbCtx;
  const before = yield* readCanvasEffect(input.canvasId);
  const bind = input.bind;
  const arrival = before.nodes.find((item) => item.id === input.to)?.nodeId;
  const fieldId = bind === undefined ? undefined : yield* bindableFieldEffect(bind, arrival);
  const id = yield* freshId;
  const bindingId = yield* freshId;
  const { doc, edge } = yield* canvasStep(() =>
    connectItems(before, {
      id,
      bindingId,
      from: input.from,
      to: input.to,
      ...connectionLook(input),
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
  // A locked card is promoted too: it changes what the card shows, not where
  // it stands, as the inspector's words and node stay editable on one.
  const text = yield* canvasStep(() => promotableText(before, input.id));
  // The node and the card that shows it are one transaction: a failed canvas
  // write leaves no node behind, and the pair is one step of history.
  const planned = yield* planNodeAddEffect({
    text,
    ...(input.nodeId === undefined ? {} : { id: input.nodeId }),
  });
  const nodeId = planned.id;
  const doc = yield* canvasStep(() => promoteItem(before, input.id, nodeId));
  const written = yield* commitCanvasEffect({
    canvasId: input.canvasId,
    doc,
    also: () => planned.upserts,
  });
  return { canvasId: input.canvasId, id: input.id, nodeId, lints: written.lints };
});

/** The verbs as the canvas family contributes them, ids local to `ext.canvas`. */
/**
 * What a canvas verb acts on: its canvas (`canvasId`), so a script reaches
 * through it only a canvas its subject holds (DESIGN.md → Sandbox → Grants).
 * `promote` declares none: it makes a node at the outline's root, which no
 * subject holds, so no script promotes.
 */
const ON_ITS_CANVAS = ["canvasId"] as const;

export const CANVAS_VERBS: ExtensionAction[] = [
  {
    id: "describe",
    title: "Describe a canvas",
    description:
      "Say what is on a canvas for an agent that cannot see it: each item's kind, words and box " +
      "(min/max along x right, y down the page, z up), its colour and the looks it draws that are " +
      "not its kind's defaults, and how items stand: on, in a frame, linked, " +
      "and near by a side in plain words (left, right, north, south, above, below — the canvas's own " +
      "axes). Items in focus are in full, the rest on screen blurred, what is off screen counted per " +
      "frame; with no focus and no open tab every item is in full. Also its lints and camera.",
    mode: { kind: "read" },
    targets: ON_ITS_CANVAS,
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
    targets: ON_ITS_CANVAS,
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
    targets: ON_ITS_CANVAS,
    inputSchema: placeInput,
    outputSchema: placeOutput,
    effect: canvasPlaceEffect,
  },
  {
    id: "arrange",
    title: "Arrange items",
    description:
      "Lay items out as a row, column, grid, ring or stack, or as layers whose height follows a " +
      "field's value on each item's node; line them up on an edge or spread them evenly; or, " +
      "instead, move them in the paint order (front, back, one step) or mirror them (flip x or " +
      "y). A frame's members move with it. One write (one undo step).",
    mode: { kind: "write" },
    targets: ON_ITS_CANVAS,
    inputSchema: arrangeInput,
    outputSchema: arrangeOutput,
    effect: canvasArrangeEffect,
  },
  {
    id: "connect",
    title: "Connect two items",
    description:
      "Draw an arrow from one item to another, between the sides facing each other unless sides " +
      "or precise anchors are given; routed as a curve, straight, an arc (bowed by `bend`) or an " +
      "elbow; each end bare or wearing an arrow, open, dot, diamond or bar head; with a colour and " +
      "line looks. With `bind`, also set that ref field on the from item's node to the to item's " +
      "node, once (both must stand for nodes).",
    mode: { kind: "write" },
    targets: ON_ITS_CANVAS,
    inputSchema: connectInput,
    outputSchema: connectOutput,
    effect: canvasConnectEffect,
  },
  {
    id: "group",
    title: "Group items",
    description: "Gather items into a new frame a grid step round them; they become its members.",
    mode: { kind: "write" },
    targets: ON_ITS_CANVAS,
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
    targets: ON_ITS_CANVAS,
    inputSchema: ungroupInput,
    outputSchema: ungroupOutput,
    effect: canvasUngroupEffect,
  },
  COMMENT_VERB,
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
