import {
  isKbNode,
  upsertCanvasEdge,
  upsertCanvasNode,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSide,
} from "@kb/canvas";
import { sidePoint } from "@/lib/canvas-edge-path";
import {
  EMPTY_SELECTION,
  addNodes,
  marqueeSelect,
  selectEdge,
  type CanvasSelection,
} from "@/lib/canvas-selection";

const DRAG_THRESHOLD = 4;
const MIN_NODE_W = 80;
const MIN_NODE_H = 40;
const SNAP_TOL = 5;

export interface Point {
  x: number;
  y: number;
}

interface Rect extends Point {
  w: number;
  h: number;
}

interface SnapGuide {
  axis: "x" | "y";
  pos: number;
}

export type ResizeCorner = "nw" | "ne" | "se" | "sw";

type Drag =
  | { kind: "pan"; x: number; y: number; ox: number; oy: number }
  | {
      kind: "move-pending";
      id: string;
      startX: number;
      startY: number;
      origPositions: Map<string, Point>;
    }
  | {
      kind: "move";
      startX: number;
      startY: number;
      origPositions: Map<string, Point>;
    }
  | {
      kind: "resize-pending";
      id: string;
      corner: ResizeCorner;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
    }
  | {
      kind: "resize";
      id: string;
      corner: ResizeCorner;
      startX: number;
      startY: number;
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

export interface PointerState {
  drag: Drag | null;
  pan: Point;
  marqueeRect: Rect | null;
  snapGuides: SnapGuide[];
}

export type CanvasPointerEvent =
  | { type: "pan/set"; pan: Point }
  | { type: "pan/start"; screen: Point }
  | { type: "move/start"; id: string; screen: Point }
  | { type: "resize/start"; id: string; corner: ResizeCorner; screen: Point }
  | { type: "edge/start"; fromCardId: string; fromSide: CanvasSide; screen: Point }
  | { type: "marquee/start"; screen: Point; world: Point; additive: boolean }
  | { type: "pointer/move"; screen: Point; world: Point; shiftKey: boolean }
  | {
      type: "pointer/end";
      screen: Point;
      edgeTargetId?: string;
      edgeWorld?: Point;
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
  persist?: "history" | "silent" | "flush";
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

function startMove(
  state: PointerState,
  event: Extract<CanvasPointerEvent, { type: "move/start" }>,
  ctx: PointerContext,
): PointerResult {
  const selectedIds = ctx.selection.nodeIds.has(event.id)
    ? ctx.selection.nodeIds
    : new Set([event.id]);
  const origPositions = new Map<string, Point>();
  for (const id of selectedIds) {
    const node = ctx.byId.get(id);
    if (node) origPositions.set(id, { x: node.x, y: node.y });
  }
  return result({
    ...state,
    drag: {
      kind: "move-pending",
      id: event.id,
      startX: event.screen.x,
      startY: event.screen.y,
      origPositions,
    },
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
      origX: node.x,
      origY: node.y,
      origW: node.width,
      origH: node.height,
    },
  });
}

/** The first edge pair within `SNAP_TOL`, as the offset that closes the gap. */
function snapOffset(
  pairs: readonly (readonly [number, number])[],
): { delta: number; pos: number } | undefined {
  for (const [mine, theirs] of pairs) {
    if (Math.abs(mine - theirs) < SNAP_TOL) return { delta: theirs - mine, pos: theirs };
  }
  return undefined;
}

function snapMove(
  drag: Extract<Drag, { kind: "move" }>,
  dx: number,
  dy: number,
  ctx: PointerContext,
): { dx: number; dy: number; guides: SnapGuide[] } {
  const guides: SnapGuide[] = [];
  const movingIds = new Set(drag.origPositions.keys());
  const firstOrig = drag.origPositions.values().next().value;
  const firstId = drag.origPositions.keys().next().value;
  if (firstOrig === undefined || firstId === undefined || movingIds.size === 0) {
    return { dx, dy, guides };
  }
  const movingNode = ctx.byId.get(firstId);
  if (!movingNode) return { dx, dy, guides };

  const myLeft = firstOrig.x + dx;
  const myTop = firstOrig.y + dy;
  const myRight = myLeft + movingNode.width;
  const myBottom = myTop + movingNode.height;
  const myCx = (myLeft + myRight) / 2;
  const myCy = (myTop + myBottom) / 2;
  for (const other of ctx.doc.nodes) {
    if (movingIds.has(other.id)) continue;
    const oLeft = other.x;
    const oRight = other.x + other.width;
    const oTop = other.y;
    const oBottom = other.y + other.height;
    const oCx = (oLeft + oRight) / 2;
    const oCy = (oTop + oBottom) / 2;
    const xSnap = snapOffset([
      [myLeft, oLeft],
      [myLeft, oRight],
      [myRight, oLeft],
      [myRight, oRight],
      [myCx, oCx],
    ]);
    const ySnap = snapOffset([
      [myTop, oTop],
      [myTop, oBottom],
      [myBottom, oTop],
      [myBottom, oBottom],
      [myCy, oCy],
    ]);
    if (xSnap) {
      dx += xSnap.delta;
      guides.push({ axis: "x", pos: xSnap.pos });
    }
    if (ySnap) {
      dy += ySnap.delta;
      guides.push({ axis: "y", pos: ySnap.pos });
    }
    if (guides.length >= 2) break;
  }
  return { dx, dy, guides };
}

function moveNodes(
  state: PointerState,
  drag: Extract<Drag, { kind: "move" }>,
  event: Extract<CanvasPointerEvent, { type: "pointer/move" }>,
  ctx: PointerContext,
): PointerResult {
  const delta = snapMove(
    drag,
    (event.screen.x - drag.startX) / ctx.zoom,
    (event.screen.y - drag.startY) / ctx.zoom,
    ctx,
  );
  let doc = ctx.doc;
  for (const [id, orig] of drag.origPositions) {
    const node = ctx.byId.get(id);
    if (!node) continue;
    doc = upsertCanvasNode(doc, {
      ...node,
      x: orig.x + delta.dx,
      y: orig.y + delta.dy,
    });
  }
  return result({ ...state, snapGuides: delta.guides }, { doc, persist: "silent" });
}

function resizedRect(
  drag: Extract<Drag, { kind: "resize" }>,
  event: Extract<CanvasPointerEvent, { type: "pointer/move" }>,
  zoom: number,
): Rect {
  const dx = (event.screen.x - drag.startX) / zoom;
  const dy = (event.screen.y - drag.startY) / zoom;
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
  const rect = resizedRect(drag, event, ctx.zoom);
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
    const distance = Math.hypot(event.screen.x - drag.startX, event.screen.y - drag.startY);
    if (distance < DRAG_THRESHOLD) return result(state);
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
    const distance = Math.hypot(event.screen.x - drag.startX, event.screen.y - drag.startY);
    if (distance < DRAG_THRESHOLD) return result(state);
    return result({
      ...state,
      drag: {
        kind: "move",
        startX: drag.startX,
        startY: drag.startY,
        origPositions: drag.origPositions,
      },
    });
  }
  if (drag.kind === "move") return moveNodes(state, drag, event, ctx);
  if (drag.kind === "resize-pending") {
    const distance = Math.hypot(event.screen.x - drag.startX, event.screen.y - drag.startY);
    if (distance < DRAG_THRESHOLD) return result(state);
    return result({ ...state, drag: { ...drag, kind: "resize" } });
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

function finishMove(
  state: PointerState,
  drag: Extract<Drag, { kind: "move" }>,
  event: Extract<CanvasPointerEvent, { type: "pointer/end" }>,
  ctx: PointerContext,
): PointerResult {
  const dx = (event.screen.x - drag.startX) / ctx.zoom;
  const dy = (event.screen.y - drag.startY) / ctx.zoom;
  let doc = ctx.doc;
  for (const [id, orig] of drag.origPositions) {
    const node = ctx.byId.get(id);
    if (!node) continue;
    doc = upsertCanvasNode(doc, { ...node, x: orig.x + dx, y: orig.y + dy });
  }
  return result({ ...state, drag: null, snapGuides: [] }, { doc, persist: "history" });
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
    event.edgeWorld === undefined ||
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
    toSide: closestPort(to, event.edgeWorld.x, event.edgeWorld.y),
    toEnd: "arrow",
    kbLink: {
      mode: "layout",
      via: "prop",
      fieldId: "",
      sourceNodeId: isKbNode(from) ? from.nodeId : "",
      targetNodeId: isKbNode(to) ? to.nodeId : "",
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
  if (drag.kind === "move") return finishMove(state, drag, event, ctx);
  if (drag.kind === "resize") {
    return result({ ...state, drag: null }, { doc: ctx.doc, persist: "history" });
  }
  if (drag.kind === "edge") return finishEdge(state, drag, event, ctx);
  return result({ ...state, drag: null });
}

export function pointerReduce(
  state: PointerState,
  event: CanvasPointerEvent,
  ctx: PointerContext,
): PointerResult {
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
  if (event.type === "move/start") return startMove(state, event, ctx);
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
