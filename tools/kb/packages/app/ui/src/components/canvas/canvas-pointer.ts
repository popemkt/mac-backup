import {
  boxFrame,
  boxToWorld,
  canvasTop,
  carriedBy,
  selectionPivot,
  settleMembership,
  snapCarry,
  snapPrecise,
  stillAbout,
  transformCarried,
  upsertCanvasEdge,
  upsertCanvasNode,
  withElevation,
  type CanvasCarried,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasMembership,
  type CanvasNode,
  type CanvasSide,
  type CanvasTransform,
  type SnapGuide,
  type SnappedTransform,
} from "@kb/canvas";
import { sidePoint } from "./canvas-edge-path";
import { screenToPlane, type CanvasView, type ViewSize } from "./canvas-camera";
import {
  ALONG_Z,
  groundOf,
  isTyped,
  keyInput,
  transformAt,
  type TransformConstraint,
  type TransformGround,
  type TransformInput,
  type TransformKey,
  type TransformMode,
} from "./canvas-transform-input";
import { pastSlop } from "@kb/ui-sdk";
import {
  EMPTY_SELECTION,
  addNodes,
  marqueeSelect,
  pickAllIn,
  selectEdge,
  type CanvasScope,
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
   * turned by the top-view rotate handle, moved by the 3D gizmo, or made
   * modally from the keyboard (G, S, E) with no button held.
   */
  | {
      kind: "transform";
      /** What it carries — the items, the lead first, and their members — as each was when it began. */
      carried: CanvasCarried;
      /** The items it leaves where they are, read once: what it is read against, snaps to and stands on. */
      ground: TransformGround;
      /** How the pointer makes the transform; null for a handle that reports whole ones (the gizmo). */
      input: TransformInput | null;
      /** Where the press went down on screen, until the pointer has gone past the slop. */
      slop: Point | null;
      /** The transform the preview last showed, which the release (or a confirm) writes. */
      applied: CanvasTransform | null;
      /**
       * Begun from the keyboard: it follows the pointer with no button held,
       * a release does not end it, and only a confirm or a cancel does.
       */
      modal: boolean;
      /** Where the pointer last was, and whether ⌘ was held: what a key reads the input at. */
      at: Point;
      free: boolean;
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
 * either projection. `free` (⌘ held) suspends every snap (`@kb/canvas` `snap.ts`).
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
  /** A modal transform of the selection begins, the pointer at `screen` (G, S, E). */
  | { type: "transform/begin"; mode: TransformMode; screen: Point }
  /** A key pressed during a modal transform: an axis, a typed value, or another mode. */
  | { type: "transform/key"; key: TransformKey }
  /** ⌘ (or Ctrl) went down or up during a modal transform. */
  | { type: "transform/free"; free: boolean }
  /** A modal transform is confirmed (Enter): written as one history step. */
  | { type: "transform/confirm" }
  /** A press during a modal transform, in either projection: it confirms or cancels (`pressModal`). */
  | { type: "transform/press"; button: number; ctrlKey: boolean }
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

/**
 * What the reducer reads a gesture against: the document, who belongs to
 * whom on it, the selection and the scope it is made in, and the showing
 * camera.
 */
export interface PointerContext {
  doc: CanvasDoc;
  membership: CanvasMembership;
  selection: CanvasSelection;
  scope: CanvasScope;
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

/**
 * What a transform of `ids` carries, as it is now — the items and every
 * member below them — and the ground it leaves where it is.
 */
function carry(
  ids: Iterable<string>,
  ctx: PointerContext,
): { readonly carried: CanvasCarried; readonly ground: TransformGround } {
  const carried = carriedBy(ctx.doc.nodes, ids);
  const moving = new Set([...carried.items, ...carried.members].map((node) => node.id));
  return { carried, ground: groundOf(ctx.doc.nodes, moving) };
}

/** How a pointer-made transform of some items begins. */
interface TransformStart {
  readonly mode: TransformMode;
  readonly constraint: TransformConstraint | null;
  /** Where the pointer is, on screen. */
  readonly screen: Point;
  /** Begun from the keyboard rather than by a press. */
  readonly modal: boolean;
}

/**
 * A transform drag of what `ids` carry, made by the pointer from `start`. A
 * press waits out the slop and its grab holds the pressed item's top, where
 * a solid is taken hold of; a modal transform follows at once and holds the
 * pivot. It turns and scales about its items' pivot, and their members
 * follow.
 */
function startTransform(
  state: PointerState,
  ids: Iterable<string>,
  start: TransformStart,
  ctx: PointerContext,
  pressed?: CanvasNode,
): PointerResult {
  const { carried, ground } = carry(ids, ctx);
  const lead = carried.items[0];
  if (lead === undefined) return result(state);
  const pivot = selectionPivot(carried.items);
  const held = pressed === undefined ? null : boxFrame(pressed).centre;
  const input: TransformInput = {
    mode: start.mode,
    constraint: start.constraint,
    pivot,
    own: boxFrame(lead).matrix,
    anchor: held === null || pressed === undefined ? pivot : { ...held, z: canvasTop(pressed) },
    from: start.screen,
    typed: "",
  };
  const { screen, modal } = start;
  return result({
    ...state,
    drag: {
      kind: "transform",
      carried,
      ground,
      input,
      slop: modal ? null : screen,
      applied: null,
      modal,
      at: screen,
      free: false,
    },
  });
}

/** A press on `id` starts a transform of the items it carries, as `mode` says, held to `constraint`. */
function startPress(
  state: PointerState,
  press: { readonly id: string; readonly screen: Point },
  how: Pick<TransformStart, "mode" | "constraint">,
  ctx: PointerContext,
): PointerResult {
  const pressed = ctx.byId.get(press.id);
  if (pressed === undefined) return result(state);
  const start = { ...how, screen: press.screen, modal: false };
  return startTransform(state, carriedIds(press.id, ctx.selection), start, ctx, pressed);
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

/**
 * `t` snapped as what made it asks (`@kb/canvas` `snap.ts`): a carry across the
 * floor plan aligns and stands on surfaces; anything else snaps precisely.
 */
function snapTransform(
  drag: TransformDrag,
  t: CanvasTransform,
  ctx: PointerContext,
): SnappedTransform {
  const moving = drag.carried.items;
  const others = drag.ground.items;
  const lead = moving[0];
  const acrossFloor = drag.input?.mode === "grab" && drag.input.constraint === null;
  return lead !== undefined && acrossFloor
    ? snapCarry(t, lead, others, ctx.view.zoom)
    : snapPrecise(t, moving, others, ctx.view.zoom);
}

/** The document with what `drag` carries transformed by `t`, from where each began. */
function transformed(drag: TransformDrag, t: CanvasTransform, doc: CanvasDoc): CanvasDoc {
  return transformCarried(doc, drag.carried, t);
}

/**
 * Preview `t` on the transformed items: the document shown, never written,
 * until the release or a confirm. It is snapped unless ⌘ is held or a value
 * was typed; a pointer that cannot be read (null) leaves the preview where
 * it was.
 */
function previewTransform(
  state: PointerState,
  drag: TransformDrag,
  t: CanvasTransform | null,
  ctx: PointerContext,
): PointerResult {
  if (t === null) return result({ ...state, drag: { ...drag, slop: null } });
  const exact = drag.free || (drag.input !== null && isTyped(drag.input));
  const { transform: applied, guides } = exact
    ? { transform: t, guides: [] }
    : snapTransform(drag, t, ctx);
  return result(
    { ...state, drag: { ...drag, slop: null, applied }, snapGuides: guides },
    { doc: transformed(drag, applied, ctx.doc), persist: "silent" },
  );
}

/** Read `drag`'s pointer input where the pointer is (`drag.at`), and preview what it makes. */
function readInput(state: PointerState, drag: TransformDrag, ctx: PointerContext): PointerResult {
  if (drag.input === null) return result(state);
  const t = transformAt(drag.input, drag.at, ctx, drag.ground);
  return previewTransform(state, drag, t, ctx);
}

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
  return readInput(state, { ...drag, at: event.screen, free: event.free ?? false }, ctx);
}

/**
 * Write `final` over what `drag` carries as one history step (nothing, when
 * there is none). The items it lets go of then belong to the frame that
 * holds them where they landed, or to none (`settleMembership`); their
 * members came with them, so they stay where they belong.
 */
function commitTransform(
  state: PointerState,
  drag: TransformDrag,
  final: CanvasTransform | null,
  ctx: PointerContext,
): PointerResult {
  const done = { ...state, drag: null, snapGuides: [] };
  if (final === null) return result(done);
  const doc = settleMembership(
    transformed(drag, final, ctx.doc),
    drag.carried.items.map((item) => item.id),
  );
  return result(done, { doc, persist: "history" });
}

/** A modal transform of the selection, begun from the keyboard with the pointer at `screen`. */
function beginModal(
  state: PointerState,
  event: Extract<CanvasPointerEvent, { type: "transform/begin" }>,
  ctx: PointerContext,
): PointerResult {
  if (state.drag !== null) return result(state);
  const { mode, screen } = event;
  const start = { mode, constraint: null, screen, modal: true };
  return startTransform(state, ctx.selection.nodeIds, start, ctx);
}

/** A key during a modal transform: the input changes, and is read again where the pointer is. */
function keyModal(
  state: PointerState,
  event: Extract<CanvasPointerEvent, { type: "transform/key" | "transform/free" }>,
  ctx: PointerContext,
): PointerResult {
  const drag = state.drag;
  if (drag?.kind !== "transform" || !drag.modal || drag.input === null) return result(state);
  if (event.type === "transform/free") return readInput(state, { ...drag, free: event.free }, ctx);
  const input = keyInput(drag.input, event.key, drag.at);
  if (input.mode === drag.input.mode) return readInput(state, { ...drag, input }, ctx);
  // Another mode sets the last one aside: from the items as they were, even
  // where the new one cannot read the pointer yet.
  const fresh = { ...drag, input, applied: null };
  const read = readInput(state, fresh, ctx);
  return read.doc === undefined
    ? result(read.state, {
        doc: transformed(drag, stillAbout(input.pivot), ctx.doc),
        persist: "silent",
      })
    : read;
}

/**
 * A press during a modal transform ends it, and means nothing else: a plain
 * primary press confirms; any other — the right or middle button, or a
 * Ctrl-click, which is macOS's right click — cancels.
 */
function pressModal(
  state: PointerState,
  event: Extract<CanvasPointerEvent, { type: "transform/press" }>,
  ctx: PointerContext,
): PointerResult {
  const drag = state.drag;
  if (drag?.kind !== "transform" || !drag.modal) return result(state);
  if (event.button === 0 && !event.ctrlKey) return commitTransform(state, drag, drag.applied, ctx);
  return pointerReduce(state, { type: "pointer/cancel" }, ctx);
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
      {
        selection: addNodes(
          drag.baseSel,
          pickAllIn(ctx.membership, marqueeSelect(ctx.doc.nodes, marqueeRect), ctx.scope),
        ),
      },
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
 * writes nothing. A modal transform holds no button, so a release is not
 * its end.
 */
function endTransform(
  state: PointerState,
  drag: TransformDrag,
  event: Extract<CanvasPointerEvent, { type: "pointer/end" }>,
  ctx: PointerContext,
): PointerResult {
  if (drag.modal) return result(state);
  if (drag.slop !== null) return commitTransform(state, drag, null, ctx);
  const last = readInput(state, { ...drag, at: event.screen, free: event.free ?? false }, ctx);
  const final = last.state.drag?.kind === "transform" ? last.state.drag.applied : drag.applied;
  return commitTransform(state, drag, final, ctx);
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

/** The events that drive a transform drag directly: the gizmo's, and a modal transform's. */
type TransformEvent = Extract<CanvasPointerEvent, { type: `transform/${string}` }>;

const isTransformEvent = (event: CanvasPointerEvent): event is TransformEvent =>
  event.type.startsWith("transform/");

function reduceTransform(
  state: PointerState,
  event: TransformEvent,
  ctx: PointerContext,
): PointerResult {
  const drag = state.drag?.kind === "transform" ? state.drag : null;
  switch (event.type) {
    case "transform/start": {
      const { carried, ground } = carry(ctx.selection.nodeIds, ctx);
      if (carried.items.length === 0) return result(state);
      const at = { x: 0, y: 0 };
      return result({
        ...state,
        drag: {
          kind: "transform",
          carried,
          ground,
          input: null,
          slop: null,
          applied: null,
          modal: false,
          at,
          free: false,
        },
      });
    }
    case "transform/move":
      if (drag === null) return result(state);
      return previewTransform(state, { ...drag, free: event.free ?? false }, event.transform, ctx);
    case "transform/begin":
      return beginModal(state, event, ctx);
    case "transform/key":
    case "transform/free":
      return keyModal(state, event, ctx);
    case "transform/confirm":
      if (drag === null || !drag.modal) return result(state);
      return commitTransform(state, drag, drag.applied, ctx);
    case "transform/press":
      return pressModal(state, event, ctx);
    default:
      return result(state);
  }
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
    return startPress(state, event, { mode: "grab", constraint: event.along ?? null }, ctx);
  }
  if (event.type === "turn/start") {
    return startPress(state, event, { mode: "rotate", constraint: ALONG_Z }, ctx);
  }
  if (event.type === "resize/start") return startResize(state, event, ctx);
  if (isTransformEvent(event)) return reduceTransform(state, event, ctx);
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
