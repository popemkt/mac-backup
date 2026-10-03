import {
  boxFrame,
  boxToWorld,
  canvasTop,
  selectionPivot,
  transformItem,
  upsertCanvasEdge,
  upsertCanvasNode,
  withElevation,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSide,
  type CanvasTransform,
} from "@kb/canvas";
import { sidePoint } from "./canvas-edge-path";
import {
  snapCanvasLift,
  snapCanvasMove,
  snapToSurface,
  snapTurn,
  type SnapGuide,
} from "./canvas-snap";
import { screenToPlane, type CanvasView, type ViewSize } from "./canvas-camera";
import {
  ALONG_Z,
  transformAt,
  type TransformConstraint,
  type TransformInput,
} from "./canvas-transform-input";
import { pastSlop } from "@/sdk";
import {
  EMPTY_SELECTION,
  addNodes,
  marqueeSelect,
  selectEdge,
  type CanvasSelection,
} from "./canvas-selection";

const MIN_NODE_W = 80;
const MIN_NODE_H = 40;

export interface Point {
  x: number;
  y: number;
}

interface Rect extends Point {
  w: number;
  h: number;
}

export type ResizeCorner = "nw" | "ne" | "se" | "sw";

type Drag =
  | { kind: "pan"; x: number; y: number; ox: number; oy: number }
  | {
      kind: "resize-pending";
      id: string;
      corner: ResizeCorner;
      startX: number;
      startY: number;
      start: Point;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
    }
  | {
      kind: "resize";
      id: string;
      corner: ResizeCorner;
      start: Point;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
    }
  /**
   * Items under one transform about a pivot: carried by a press on a card,
   * turned by the top-view rotate handle, or moved by the 3D gizmo.
   */
  | {
      kind: "transform";
      /** Each transformed item as it was when the gesture began. */
      orig: ReadonlyMap<string, CanvasNode>;
      /** How the pointer makes the transform; null for a handle that reports whole ones (the gizmo). */
      input: TransformInput | null;
      /** Where the press went down on screen, until the pointer has gone past the slop. */
      slop: Point | null;
      /** The transform the preview last showed, which the release writes. */
      applied: CanvasTransform | null;
    }
  | {
      kind: "edge";
      fromCardId: string;
      fromSide: CanvasSide;
      x: number;
      y: number;
    }
  | {
      kind: "marquee-pending";
      startX: number;
      startY: number;
      worldX: number;
      worldY: number;
      additive: boolean;
    }
  | {
      kind: "marquee";
      worldX: number;
      worldY: number;
      curX: number;
      curY: number;
      additive: boolean;
      baseSel: CanvasSelection;
    };

type TransformDrag = Extract<Drag, { kind: "transform" }>;

export interface PointerState {
  drag: Drag | null;
  pan: Point;
  marqueeRect: Rect | null;
  snapGuides: SnapGuide[];
}

/**
 * A gesture as the projection that saw it reports it: where the pointer is
 * on screen (CSS pixels from the viewport's top left), which decides slop
 * and panning. The reducer reads that point through the showing camera
 * (`PointerContext`), so where a card goes is the camera model's answer in
 * either projection. `free` (⌘ held) suspends every snap (`canvas-snap`).
 */
export type CanvasPointerEvent =
  | { type: "pointer/cancel" }
  | { type: "pan/set"; pan: Point }
  | { type: "pan/start"; screen: Point }
  /** A press on a card carries it, across the floor plan or held to `along` (Alt: Z). */
  | { type: "move/start"; id: string; screen: Point; along?: TransformConstraint }
  | { type: "resize/start"; id: string; corner: ResizeCorner; screen: Point }
  | { type: "turn/start"; id: string; screen: Point }
  | { type: "transform/start" }
  | { type: "transform/move"; transform: CanvasTransform; free?: boolean }
  | { type: "edge/start"; fromCardId: string; fromSide: CanvasSide; screen: Point }
  | { type: "marquee/start"; screen: Point; additive: boolean }
  | { type: "pointer/move"; screen: Point; shiftKey: boolean; free?: boolean }
  | {
      type: "pointer/end";
      screen: Point;
      shiftKey?: boolean;
      free?: boolean;
      edgeTargetId?: string;
      edgeId?: string;
      edgeBindingId?: string;
    };

/** What the reducer reads a gesture against: the document, the selection, and the showing camera. */
export interface PointerContext {
  doc: CanvasDoc;
  selection: CanvasSelection;
  byId: ReadonlyMap<string, CanvasNode>;
  view: CanvasView;
  size: ViewSize;
}

export interface PointerResult {
  state: PointerState;
  doc?: CanvasDoc;
  selection?: CanvasSelection;
  persist?: "history" | "silent" | "flush" | "cancel";
  guides: readonly SnapGuide[];
}

export function createPointerState(pan: Point = { x: 40, y: 40 }): PointerState {
  return { drag: null, pan, marqueeRect: null, snapGuides: [] };
}

function result(
  state: PointerState,
  rest: Omit<PointerResult, "state" | "guides"> = {},
): PointerResult {
  return { state, guides: state.snapGuides, ...rest };
}

/**
 * The floor point under `screen`. Only the 3D view can hold the floor
 * edge-on, and none of the gestures that ask (resize, marquee, edge) are
 * made there; the screen point stands in.
 */
function floorAt(ctx: PointerContext, screen: Point): Point {
  const at = screenToPlane(ctx.view, ctx.size, screen, 0);
  return at === null ? screen : { x: at.x, y: at.y };
}

/** The ids a press on `id` carries: the selection when `id` is in it, otherwise `id` alone. */
function carriedIds(id: string, selection: CanvasSelection): ReadonlySet<string> {
  return selection.nodeIds.has(id) ? selection.nodeIds : new Set([id]);
}

/** The items `ids` name, as they are now, by id. */
function itemsOf(ids: Iterable<string>, ctx: PointerContext): ReadonlyMap<string, CanvasNode> {
  return new Map(
    [...ids].flatMap((id) => {
      const node = ctx.byId.get(id);
      return node ? [[id, node] as const] : [];
    }),
  );
}

/**
 * A transform drag over the items a press on `id` carries, made by the
 * pointer as `mode` says, held to `constraint`, from `screen` on: a grab
 * holds the pressed item's top, where a solid is taken hold of.
 */
function startPointerTransform(
  state: PointerState,
  press: {
    readonly id: string;
    readonly screen: Point;
    readonly mode: TransformInput["mode"];
    readonly constraint: TransformConstraint | null;
  },
  ctx: PointerContext,
): PointerResult {
  const orig = itemsOf(carriedIds(press.id, ctx.selection), ctx);
  const pressed = ctx.byId.get(press.id);
  const lead = orig.values().next().value;
  if (pressed === undefined || lead === undefined) return result(state);
  const centre = boxFrame(pressed).centre;
  const input: TransformInput = {
    mode: press.mode,
    constraint: press.constraint,
    pivot: selectionPivot([...orig.values()]),
    own: boxFrame(lead).matrix,
    anchor: { x: centre.x, y: centre.y, z: canvasTop(pressed) },
    from: press.screen,
  };
  return result({
    ...state,
    drag: { kind: "transform", orig, input, slop: press.screen, applied: null },
  });
}

function startResize(
  state: PointerState,
  event: Extract<CanvasPointerEvent, { type: "resize/start" }>,
  ctx: PointerContext,
): PointerResult {
  const node = ctx.byId.get(event.id);
  if (!node) return result(state);
  return result({
    ...state,
    drag: {
      kind: "resize-pending",
      id: event.id,
      corner: event.corner,
      startX: event.screen.x,
      startY: event.screen.y,
      start: floorAt(ctx, event.screen),
      origX: node.x,
      origY: node.y,
      origW: node.width,
      origH: node.height,
    },
  });
}

/**
 * A drag across the floor as a move across an item's face: the face's top
 * view is its own axes seen from above, so the drag is read back through
 * that view; a face seen edge-on takes no part of it.
 */
function acrossFace(node: CanvasNode, dx: number, dy: number): Point {
  const m = boxFrame(node).matrix;
  const det = m[0] * m[4] - m[1] * m[3];
  if (Math.abs(det) < 1e-6) return { x: 0, y: 0 };
  return { x: (m[4] * dx - m[1] * dy) / det, y: (m[0] * dy - m[3] * dx) / det };
}

/**
 * The footprint a resize drag gives, in the item's own terms: as if it were
 * unturned, the pointer's travel read across its face (`acrossFace`).
 */
function resizedRect(
  drag: Extract<Drag, { kind: "resize" }>,
  at: { readonly world: Point; readonly shiftKey: boolean },
  node: CanvasNode,
): Rect {
  const { x: dx, y: dy } = acrossFace(node, at.world.x - drag.start.x, at.world.y - drag.start.y);
  let x = drag.origX;
  let y = drag.origY;
  let w = drag.origW;
  let h = drag.origH;
  if (drag.corner === "se" || drag.corner === "ne") w = Math.max(MIN_NODE_W, drag.origW + dx);
  if (drag.corner === "sw" || drag.corner === "nw") {
    w = Math.max(MIN_NODE_W, drag.origW - dx);
    x = drag.origX + drag.origW - w;
  }
  if (drag.corner === "se" || drag.corner === "sw") h = Math.max(MIN_NODE_H, drag.origH + dy);
  if (drag.corner === "ne" || drag.corner === "nw") {
    h = Math.max(MIN_NODE_H, drag.origH - dy);
    y = drag.origY + drag.origH - h;
  }
  if (at.shiftKey && drag.origW > 0 && drag.origH > 0) {
    const ratio = drag.origW / drag.origH;
    if (w / h > ratio) w = Math.max(MIN_NODE_W, h * ratio);
    else h = Math.max(MIN_NODE_H, w / ratio);
  }
  if (drag.corner.endsWith("w")) x = drag.origX + drag.origW - w;
  if (drag.corner.startsWith("n")) y = drag.origY + drag.origH - h;
  return { x, y, w, h };
}

function resizeNode(
  state: PointerState,
  drag: Extract<Drag, { kind: "resize" }>,
  at: { readonly screen: Point; readonly shiftKey: boolean },
  ctx: PointerContext,
): PointerResult {
  const node = ctx.byId.get(drag.id);
  if (!node) return result(state);
  const rect = resizedRect(drag, { world: floorAt(ctx, at.screen), shiftKey: at.shiftKey }, node);
  // The footprint changed in the item's own frame: its centre moves along its own axes.
  const was = { ...node, x: drag.origX, y: drag.origY, width: drag.origW, height: drag.origH };
  const centre = boxToWorld(boxFrame(was), {
    x: rect.x + rect.w / 2 - (drag.origX + drag.origW / 2),
    y: rect.y + rect.h / 2 - (drag.origY + drag.origH / 2),
    z: 0,
  });
  const doc = upsertCanvasNode(
    ctx.doc,
    withElevation(
      {
        ...node,
        x: centre.x - rect.w / 2,
        y: centre.y - rect.h / 2,
        width: rect.w,
        height: rect.h,
      },
      centre.z - boxFrame(was).half.z,
    ),
  );
  return result(state, { doc, persist: "silent" });
}

/** The items a transform drag leaves where they are: what it snaps to and stands on. */
const othersOf = (drag: TransformDrag, ctx: PointerContext) =>
  ctx.doc.nodes.filter((node) => !drag.orig.has(node.id));

/**
 * `t` snapped as its input asks: a carry across the floor plan aligns on x
 * and y and stands on the surface it comes over; a carry held to Z aligns
 * with the heights other items stand at; a turn goes in 15° steps.
 */
function snapTransform(
  drag: TransformDrag,
  t: CanvasTransform,
  ctx: PointerContext,
): { transform: CanvasTransform; guides: SnapGuide[] } {
  const lead = drag.orig.values().next().value;
  const others = othersOf(drag, ctx);
  const { input } = drag;
  if (lead === undefined || input?.mode !== "grab") return { transform: snapTurn(t), guides: [] };
  const zoom = ctx.view.zoom;
  if (input.constraint === null) {
    const aligned = snapCanvasMove(lead, others, t.move.x, t.move.y, zoom);
    const surface = snapToSurface(lead, others, aligned.dx, aligned.dy);
    return {
      transform: { ...t, move: { x: aligned.dx, y: aligned.dy, z: surface.dz } },
      guides: [...aligned.guides, ...surface.guides],
    };
  }
  const { axis, plane, space } = input.constraint;
  if (axis === ALONG_Z.axis && plane === ALONG_Z.plane && space === ALONG_Z.space) {
    const lifted = snapCanvasLift(lead, others, t.move.z, zoom);
    return { transform: { ...t, move: { ...t.move, z: lifted.dz } }, guides: lifted.guides };
  }
  return { transform: t, guides: [] };
}

/** The document with every item of `drag` transformed by `t`. */
function transformed(drag: TransformDrag, t: CanvasTransform, doc: CanvasDoc): CanvasDoc {
  let next = doc;
  for (const orig of drag.orig.values()) next = upsertCanvasNode(next, transformItem(orig, t));
  return next;
}

/**
 * Preview `t` on the transformed items, snapped unless `free`: the document
 * shown, never written, until the release (`reduceEnd`). A pointer that
 * cannot be read (null) leaves the preview where it was.
 */
function previewTransform(
  state: PointerState,
  drag: TransformDrag,
  t: CanvasTransform | null,
  free: boolean,
  ctx: PointerContext,
): PointerResult {
  if (t === null) return result({ ...state, drag: { ...drag, slop: null } });
  const { transform: applied, guides } = free
    ? { transform: t, guides: [] }
    : snapTransform(drag, t, ctx);
  return result(
    { ...state, drag: { ...drag, slop: null, applied }, snapGuides: guides },
    { doc: transformed(drag, applied, ctx.doc), persist: "silent" },
  );
}

/** The transform a drag's pointer input makes with the pointer at `screen`. */
const pointerTransform = (
  input: TransformInput,
  screen: Point,
  drag: TransformDrag,
  ctx: PointerContext,
) => transformAt(input, screen, ctx, othersOf(drag, ctx));

function moveTransform(
  state: PointerState,
  drag: TransformDrag,
  event: Extract<CanvasPointerEvent, { type: "pointer/move" }>,
  ctx: PointerContext,
): PointerResult {
  const { input, slop } = drag;
  if (input === null) return result(state);
  if (slop !== null && !pastSlop(event.screen.x - slop.x, event.screen.y - slop.y)) {
    return result(state);
  }
  const t = pointerTransform(input, event.screen, drag, ctx);
  return previewTransform(state, drag, t, event.free ?? false, ctx);
}

function reduceMove(
  state: PointerState,
  event: Extract<CanvasPointerEvent, { type: "pointer/move" }>,
  ctx: PointerContext,
): PointerResult {
  const drag = state.drag;
  if (!drag) return result(state);
  if (drag.kind === "pan") {
    return result({
      ...state,
      pan: {
        x: drag.ox + event.screen.x - drag.x,
        y: drag.oy + event.screen.y - drag.y,
      },
    });
  }
  if (drag.kind === "marquee-pending") {
    if (!pastSlop(event.screen.x - drag.startX, event.screen.y - drag.startY)) return result(state);
    const world = floorAt(ctx, event.screen);
    return result({
      ...state,
      drag: {
        kind: "marquee",
        worldX: drag.worldX,
        worldY: drag.worldY,
        curX: world.x,
        curY: world.y,
        additive: drag.additive,
        baseSel: drag.additive ? ctx.selection : EMPTY_SELECTION,
      },
      marqueeRect: {
        x: drag.worldX,
        y: drag.worldY,
        w: world.x - drag.worldX,
        h: world.y - drag.worldY,
      },
    });
  }
  if (drag.kind === "marquee") {
    const world = floorAt(ctx, event.screen);
    const marqueeRect = {
      x: drag.worldX,
      y: drag.worldY,
      w: world.x - drag.worldX,
      h: world.y - drag.worldY,
    };
    return result(
      {
        ...state,
        drag: { ...drag, curX: world.x, curY: world.y },
        marqueeRect,
      },
      { selection: addNodes(drag.baseSel, marqueeSelect(ctx.doc.nodes, marqueeRect)) },
    );
  }
  if (drag.kind === "transform") return moveTransform(state, drag, event, ctx);
  if (drag.kind === "resize-pending") {
    if (!pastSlop(event.screen.x - drag.startX, event.screen.y - drag.startY)) return result(state);
    const active = {
      kind: "resize" as const,
      id: drag.id,
      corner: drag.corner,
      start: drag.start,
      origX: drag.origX,
      origY: drag.origY,
      origW: drag.origW,
      origH: drag.origH,
    };
    return resizeNode({ ...state, drag: active }, active, event, ctx);
  }
  if (drag.kind === "resize") return resizeNode(state, drag, event, ctx);
  return result({
    ...state,
    drag: { ...drag, x: event.screen.x, y: event.screen.y },
  });
}

function closestPort(node: CanvasNode, px: number, py: number): CanvasSide {
  const sides: CanvasSide[] = ["top", "right", "bottom", "left"];
  let best: { side: CanvasSide; dist: number } = { side: "left", dist: Infinity };
  for (const side of sides) {
    const point = sidePoint(node, side);
    const dist = Math.hypot(point.x - px, point.y - py);
    if (dist < best.dist) best = { side, dist };
  }
  return best.side;
}

function finishEdge(
  state: PointerState,
  drag: Extract<Drag, { kind: "edge" }>,
  event: Extract<CanvasPointerEvent, { type: "pointer/end" }>,
  ctx: PointerContext,
): PointerResult {
  if (
    event.edgeTargetId === undefined ||
    event.edgeTargetId === drag.fromCardId ||
    event.edgeId === undefined ||
    event.edgeBindingId === undefined
  ) {
    return result({ ...state, drag: null });
  }
  const from = ctx.byId.get(drag.fromCardId);
  const to = ctx.byId.get(event.edgeTargetId);
  if (!from || !to) return result({ ...state, drag: null });
  const world = floorAt(ctx, event.screen);
  const edge: CanvasEdge = {
    id: event.edgeId,
    fromNode: drag.fromCardId,
    toNode: event.edgeTargetId,
    fromSide: drag.fromSide,
    toSide: closestPort(to, world.x, world.y),
    toEnd: "arrow",
    kbLink: {
      mode: "layout",
      via: "prop",
      fieldId: "",
      sourceNodeId: from.nodeId ?? "",
      targetNodeId: to.nodeId ?? "",
      bindingId: event.edgeBindingId,
    },
  };
  return result(
    { ...state, drag: null },
    {
      doc: upsertCanvasEdge(ctx.doc, edge),
      selection: selectEdge(edge.id),
      persist: "flush",
    },
  );
}

/**
 * The release of a transform: a pointer-made one read once more where the
 * pointer let go (where it cannot be read, as the preview last had it),
 * then written as one history step; a press that never went past the slop
 * writes nothing.
 */
function endTransform(
  state: PointerState,
  drag: TransformDrag,
  event: Extract<CanvasPointerEvent, { type: "pointer/end" }>,
  ctx: PointerContext,
): PointerResult {
  const done = { ...state, drag: null, snapGuides: [] };
  if (drag.slop !== null) return result(done);
  const last =
    drag.input === null
      ? null
      : previewTransform(
          state,
          drag,
          pointerTransform(drag.input, event.screen, drag, ctx),
          event.free ?? false,
          ctx,
        );
  const final = last?.state.drag?.kind === "transform" ? last.state.drag.applied : drag.applied;
  if (final === null) return result(done);
  return result(done, { doc: transformed(drag, final, ctx.doc), persist: "history" });
}

function reduceEnd(
  state: PointerState,
  event: Extract<CanvasPointerEvent, { type: "pointer/end" }>,
  ctx: PointerContext,
): PointerResult {
  const drag = state.drag;
  if (!drag) return result(state);
  if (drag.kind === "marquee-pending") {
    return result({ ...state, drag: null }, drag.additive ? {} : { selection: EMPTY_SELECTION });
  }
  if (drag.kind === "marquee") {
    return result({ ...state, drag: null, marqueeRect: null });
  }
  if (drag.kind === "transform") return endTransform(state, drag, event, ctx);
  if (drag.kind === "resize") {
    const final = resizeNode(
      state,
      drag,
      { screen: event.screen, shiftKey: event.shiftKey ?? false },
      ctx,
    );
    return result({ ...state, drag: null }, { doc: final.doc ?? ctx.doc, persist: "history" });
  }
  if (drag.kind === "edge") return finishEdge(state, drag, event, ctx);
  return result({ ...state, drag: null });
}

export function pointerReduce(
  state: PointerState,
  event: CanvasPointerEvent,
  ctx: PointerContext,
): PointerResult {
  if (event.type === "pointer/cancel")
    return result(
      { ...state, drag: null, marqueeRect: null, snapGuides: [] },
      { persist: "cancel" },
    );
  if (event.type === "pan/set") return result({ ...state, pan: event.pan });
  if (event.type === "pan/start") {
    return result({
      ...state,
      drag: {
        kind: "pan",
        x: event.screen.x,
        y: event.screen.y,
        ox: state.pan.x,
        oy: state.pan.y,
      },
    });
  }
  if (event.type === "move/start") {
    const { id, screen } = event;
    return startPointerTransform(
      state,
      { id, screen, mode: "grab", constraint: event.along ?? null },
      ctx,
    );
  }
  if (event.type === "turn/start") {
    const { id, screen } = event;
    return startPointerTransform(state, { id, screen, mode: "rotate", constraint: ALONG_Z }, ctx);
  }
  if (event.type === "resize/start") return startResize(state, event, ctx);
  if (event.type === "transform/start") {
    const orig = itemsOf(ctx.selection.nodeIds, ctx);
    if (orig.size === 0) return result(state);
    return result({
      ...state,
      drag: { kind: "transform", orig, input: null, slop: null, applied: null },
    });
  }
  if (event.type === "transform/move") {
    const drag = state.drag;
    if (drag?.kind !== "transform") return result(state);
    return previewTransform(state, drag, event.transform, event.free ?? false, ctx);
  }
  if (event.type === "edge/start") {
    return result({
      ...state,
      drag: {
        kind: "edge",
        fromCardId: event.fromCardId,
        fromSide: event.fromSide,
        x: event.screen.x,
        y: event.screen.y,
      },
    });
  }
  if (event.type === "marquee/start") {
    const world = floorAt(ctx, event.screen);
    return result({
      ...state,
      drag: {
        kind: "marquee-pending",
        startX: event.screen.x,
        startY: event.screen.y,
        worldX: world.x,
        worldY: world.y,
        additive: event.additive,
      },
    });
  }
  if (event.type === "pointer/move") return reduceMove(state, event, ctx);
  return reduceEnd(state, event, ctx);
}
