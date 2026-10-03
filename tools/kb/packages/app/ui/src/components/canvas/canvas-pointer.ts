import {
  canvasElevation,
  upsertCanvasEdge,
  upsertCanvasNode,
  withElevation,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSide,
} from "@kb/canvas";
import { sidePoint } from "./canvas-edge-path";
import { snapCanvasLift, snapCanvasMove, snapToSurface, type SnapGuide } from "./canvas-snap";
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
  /** Carrying cards: not yet past the slop, then under way. */
  | ({ kind: "move-pending" } & Carrying)
  | ({ kind: "move" } & Carrying)
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

/** Which way carried cards follow the pointer: across their plane, or up from the floor. */
type Carry = "plane" | "lift";

interface Carrying {
  carry: Carry;
  /** Where the press went down: on screen (slop, lift), and in canvas space (the plane). */
  startX: number;
  startY: number;
  start: Point;
  /** Each carried card as it was when the press went down. */
  orig: ReadonlyMap<string, CanvasNode>;
}

export interface PointerState {
  drag: Drag | null;
  pan: Point;
  marqueeRect: Rect | null;
  snapGuides: SnapGuide[];
}

/**
 * A gesture as the projection that saw it reports it. `screen` is where the
 * pointer is on screen, which decides slop and panning; `world` is the canvas
 * point it stands for, which decides where things go. How a screen point
 * becomes a canvas point is the projection's (`components/canvas/canvas-camera`): a card
 * moves on the plane it lies in, whatever the camera.
 */
export type CanvasPointerEvent =
  | { type: "pointer/cancel" }
  | { type: "pan/set"; pan: Point }
  | { type: "pan/start"; screen: Point }
  | { type: "move/start"; id: string; screen: Point; world: Point }
  | { type: "lift/start"; id: string; screen: Point; world: Point }
  | { type: "resize/start"; id: string; corner: ResizeCorner; screen: Point; world: Point }
  | { type: "edge/start"; fromCardId: string; fromSide: CanvasSide; screen: Point }
  | { type: "marquee/start"; screen: Point; world: Point; additive: boolean }
  | { type: "pointer/move"; screen: Point; world: Point; shiftKey: boolean }
  | {
      type: "pointer/end";
      screen: Point;
      world: Point;
      shiftKey?: boolean;
      edgeTargetId?: string;
      edgeId?: string;
      edgeBindingId?: string;
    };

export interface PointerContext {
  doc: CanvasDoc;
  selection: CanvasSelection;
  zoom: number;
  byId: ReadonlyMap<string, CanvasNode>;
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

/** The ids a press on `id` carries: the selection when `id` is in it, otherwise `id` alone. */
export function carriedIds(id: string, selection: CanvasSelection): ReadonlySet<string> {
  return selection.nodeIds.has(id) ? selection.nodeIds : new Set([id]);
}

/** The cards a press on `id` carries ({@link carriedIds}). */
function carried(id: string, ctx: PointerContext): CanvasNode[] {
  return [...carriedIds(id, ctx.selection)].flatMap((one) => {
    const node = ctx.byId.get(one);
    return node ? [node] : [];
  });
}

/** Start carrying the cards a press on `id` carries, `carry`-wise. */
function startCarry(
  state: PointerState,
  carry: Carry,
  press: { readonly id: string; readonly screen: Point; readonly world: Point },
  ctx: PointerContext,
): PointerResult {
  const orig = new Map(carried(press.id, ctx).map((node) => [node.id, node] as const));
  const { screen, world } = press;
  return result({
    ...state,
    drag: { kind: "move-pending", carry, startX: screen.x, startY: screen.y, start: world, orig },
  });
}

type MoveDrag = Extract<Drag, { kind: "move" }>;

/**
 * Where each carried card goes for a pointer at `screen` / `world`, per way
 * of carrying: across the plane by the canvas-space delta, or up from the
 * floor by the drag's height in canvas units at the current zoom, whole units
 * (height is a layout value, not a measurement). Either way the carry snaps
 * to other cards' alignments on the axes it moves along (`canvas-snap`).
 */
const CARRY: Record<
  Carry,
  (
    drag: MoveDrag,
    at: { readonly screen: Point; readonly world: Point },
    ctx: PointerContext,
  ) => {
    /** A card as it is now, placed from where it was when the press went down. */
    readonly place: (node: CanvasNode, orig: CanvasNode) => CanvasNode;
    readonly guides: SnapGuide[];
  }
> = {
  plane: (drag, at, ctx) => {
    const { dx, dy, dz, guides } = snapMove(
      drag,
      at.world.x - drag.start.x,
      at.world.y - drag.start.y,
      ctx,
    );
    return {
      place: (node, orig) =>
        withElevation({ ...node, x: orig.x + dx, y: orig.y + dy }, canvasElevation(orig) + dz),
      guides,
    };
  },
  lift: (drag, at, ctx) => {
    const rise = Math.round((drag.startY - at.screen.y) / ctx.zoom);
    const { dz, guides } = snapLift(drag, rise, ctx);
    return { place: (node, orig) => withElevation(node, canvasElevation(orig) + dz), guides };
  },
};

/** The document with every carried card where the pointer at `at` takes it. */
function carryNodes(
  drag: MoveDrag,
  at: { readonly screen: Point; readonly world: Point },
  ctx: PointerContext,
) {
  const { place, guides } = CARRY[drag.carry](drag, at, ctx);
  let doc = ctx.doc;
  for (const [id, orig] of drag.orig) {
    const node = ctx.byId.get(id);
    if (node) doc = upsertCanvasNode(doc, place(node, orig));
  }
  return { doc, guides };
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
      start: event.world,
      origX: node.x,
      origY: node.y,
      origW: node.width,
      origH: node.height,
    },
  });
}

/** The carried card that leads the snap (the first), as it was, and the cards it snaps to. */
function snapLead(drag: MoveDrag, ctx: PointerContext) {
  const original = drag.orig.values().next().value;
  const node = original === undefined ? undefined : ctx.byId.get(original.id);
  if (!node || !original) return null;
  const others = ctx.doc.nodes.filter((other) => !drag.orig.has(other.id));
  return { lead: { ...node, x: original.x, y: original.y, z: original.z }, others };
}

/** A carry across the floor: aligned on x and y, standing on the surface it comes over. */
function snapMove(drag: MoveDrag, dx: number, dy: number, ctx: PointerContext) {
  const snap = snapLead(drag, ctx);
  if (snap === null) return { dx, dy, dz: 0, guides: [] };
  const aligned = snapCanvasMove(snap.lead, snap.others, dx, dy, ctx.zoom);
  const surface = snapToSurface(snap.lead, snap.others, aligned.dx, aligned.dy);
  return { ...aligned, dz: surface.dz, guides: [...aligned.guides, ...surface.guides] };
}

function snapLift(drag: MoveDrag, dz: number, ctx: PointerContext) {
  const snap = snapLead(drag, ctx);
  if (snap === null) return { dz, guides: [] };
  return snapCanvasLift(snap.lead, snap.others, dz, ctx.zoom);
}

function moveNodes(
  state: PointerState,
  drag: MoveDrag,
  event: Extract<CanvasPointerEvent, { type: "pointer/move" }>,
  ctx: PointerContext,
): PointerResult {
  const { doc, guides } = carryNodes(drag, event, ctx);
  return result({ ...state, snapGuides: guides }, { doc, persist: "silent" });
}

function resizedRect(
  drag: Extract<Drag, { kind: "resize" }>,
  event: Extract<CanvasPointerEvent, { type: "pointer/move" }>,
): Rect {
  const dx = event.world.x - drag.start.x;
  const dy = event.world.y - drag.start.y;
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
  if (event.shiftKey && drag.origW > 0 && drag.origH > 0) {
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
  event: Extract<CanvasPointerEvent, { type: "pointer/move" }>,
  ctx: PointerContext,
): PointerResult {
  const node = ctx.byId.get(drag.id);
  if (!node) return result(state);
  const rect = resizedRect(drag, event);
  const doc = upsertCanvasNode(ctx.doc, {
    ...node,
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
  });
  return result(state, { doc, persist: "silent" });
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
    return result({
      ...state,
      drag: {
        kind: "marquee",
        worldX: drag.worldX,
        worldY: drag.worldY,
        curX: event.world.x,
        curY: event.world.y,
        additive: drag.additive,
        baseSel: drag.additive ? ctx.selection : EMPTY_SELECTION,
      },
      marqueeRect: {
        x: drag.worldX,
        y: drag.worldY,
        w: event.world.x - drag.worldX,
        h: event.world.y - drag.worldY,
      },
    });
  }
  if (drag.kind === "marquee") {
    const marqueeRect = {
      x: drag.worldX,
      y: drag.worldY,
      w: event.world.x - drag.worldX,
      h: event.world.y - drag.worldY,
    };
    return result(
      {
        ...state,
        drag: { ...drag, curX: event.world.x, curY: event.world.y },
        marqueeRect,
      },
      { selection: addNodes(drag.baseSel, marqueeSelect(ctx.doc.nodes, marqueeRect)) },
    );
  }
  if (drag.kind === "move-pending") {
    if (!pastSlop(event.screen.x - drag.startX, event.screen.y - drag.startY)) return result(state);
    const active = { ...drag, kind: "move" as const };
    return moveNodes({ ...state, drag: active }, active, event, ctx);
  }
  if (drag.kind === "move") return moveNodes(state, drag, event, ctx);
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
  const edge: CanvasEdge = {
    id: event.edgeId,
    fromNode: drag.fromCardId,
    toNode: event.edgeTargetId,
    fromSide: drag.fromSide,
    toSide: closestPort(to, event.world.x, event.world.y),
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
  if (drag.kind === "move") {
    const { doc } = carryNodes(drag, event, ctx);
    return result({ ...state, drag: null, snapGuides: [] }, { doc, persist: "history" });
  }
  if (drag.kind === "resize") {
    const final = resizeNode(
      state,
      drag,
      {
        type: "pointer/move",
        screen: event.screen,
        world: event.world,
        shiftKey: event.shiftKey ?? false,
      },
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
    return startCarry(state, "plane", event, ctx);
  }
  if (event.type === "lift/start") {
    return startCarry(state, "lift", event, ctx);
  }
  if (event.type === "resize/start") return startResize(state, event, ctx);
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
    return result({
      ...state,
      drag: {
        kind: "marquee-pending",
        startX: event.screen.x,
        startY: event.screen.y,
        worldX: event.world.x,
        worldY: event.world.y,
        additive: event.additive,
      },
    });
  }
  if (event.type === "pointer/move") return reduceMove(state, event, ctx);
  return reduceEnd(state, event, ctx);
}
