/**
 * Where an edge runs (INSPIRATIONS: edges are drawings): the point each end
 * meets its item at, the way out of the item there, the route between them
 * and the heads its ends wear, in canvas space. Pure, so both projections
 * draw the one route — the DOM as an SVG path, the scene as a line through
 * its points, climbing from one end's height to the other's — and the one
 * head of each kind, and the pointer's port choice, an edge label and the
 * projection contract read the same answer.
 *
 * An end meets its item at an anchor (`fromAnchor`, `toAnchor`): a point
 * of its box, 0–1 across and down it, carried out from the box's centre
 * onto the outline its shape draws. JSON Canvas's `fromSide`/`toSide` is
 * the coarse form, a side's middle; an end with no anchor meets that.
 */
import { boxFrame, boxToLocal, boxToWorld, directionToWorld, type CanvasVec } from "./box.ts";
import type {
  CanvasAnchor,
  CanvasEdge,
  CanvasHead,
  CanvasNode,
  CanvasRoute,
  CanvasSide,
} from "./doc.ts";
import { dropExtra } from "./extra.ts";
import { CANVAS_SHAPES, itemShape, outlinePoints, type CanvasPathCommand } from "./shapes.ts";

/** Which end of an edge: the one it leaves, or the one it arrives at. */
export type EdgeEnd = "from" | "to";

/** Where an end meets its item, and which way out of the item it faces across the floor. */
export interface EdgeTerminal {
  /** The point on the item's outline, halfway up it (on a flat item, its plane). */
  readonly at: CanvasVec;
  /** The outline's outward direction across the floor there, unit length. */
  readonly out: { readonly x: number; readonly y: number };
}

/** Each side's middle, as an anchor: what JSON Canvas's `fromSide`/`toSide` names. */
const SIDE_ANCHORS: { readonly [S in CanvasSide]: CanvasAnchor } = {
  top: { x: 0.5, y: 0 },
  right: { x: 1, y: 0.5 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
};

/** The side an end meets by default: an edge leaves by the right and arrives by the left. */
const DEFAULT_SIDES: { readonly [E in EdgeEnd]: CanvasSide } = { from: "right", to: "left" };

/** The anchor an edge's `end` meets its item at: its own, or its side's middle. */
function anchorOf(edge: CanvasEdge, end: EdgeEnd): CanvasAnchor {
  const anchor = end === "from" ? edge.fromAnchor : edge.toAnchor;
  if (anchor !== undefined) return anchor;
  const side = (end === "from" ? edge.fromSide : edge.toSide) ?? DEFAULT_SIDES[end];
  return SIDE_ANCHORS[side];
}

/**
 * The point of a footprint, in its box's unit square (-1 to 1 each way),
 * that the ray from its centre through (`u`, `v`) leaves it at, and the
 * outline's outward normal there, in the same units.
 */
function onOutline(item: CanvasNode, u: number, v: number) {
  const [du, dv] = Math.hypot(u, v) < 1e-9 ? [1, 0] : [u, v];
  switch (CANVAS_SHAPES[itemShape(item)].footprint) {
    case "ellipse": {
      const s = Math.hypot(du, dv);
      return { p: { x: du / s, y: dv / s }, n: { x: du / s, y: dv / s } };
    }
    case "diamond": {
      const s = Math.abs(du) + Math.abs(dv);
      return { p: { x: du / s, y: dv / s }, n: { x: Math.sign(du), y: Math.sign(dv) } };
    }
    case "rect":
    default: {
      const s = Math.max(Math.abs(du), Math.abs(dv));
      const across = Math.abs(du) >= Math.abs(dv);
      return {
        p: { x: du / s, y: dv / s },
        n: across ? { x: Math.sign(du), y: 0 } : { x: 0, y: Math.sign(dv) },
      };
    }
  }
}

/**
 * Where an edge meets `item` at `anchor`, in canvas space: carried out from
 * the box's centre toward the anchor onto the outline its shape draws
 * (`CANVAS_SHAPES`), and the way out of the item there. A side's middle is
 * an anchor like any other.
 */
// A flat billboard stands up in 3D, but an edge meets it at its box's side
// on the floor, where it lies; and a turned billboard's anchors turn with a
// rotation it does not draw. Anchors on what is drawn come with 3D plan step 9.
// GAP [[01M42G18TDCMPK7BKD9GKS74RT]]
function terminalAt(item: CanvasNode, anchor: CanvasAnchor): EdgeTerminal {
  const frame = boxFrame(item);
  const { p, n } = onOutline(item, anchor.x * 2 - 1, anchor.y * 2 - 1);
  const at = boxToWorld(frame, { x: p.x * frame.half.x, y: p.y * frame.half.y, z: 0 });
  // A normal in unit-square terms leans by the box's aspect once stretched to it.
  const normal = { x: n.x / (frame.half.x || 1), y: n.y / (frame.half.y || 1), z: 0 };
  const out = directionToWorld(frame, normal);
  const across = Math.hypot(out.x, out.y) || 1;
  return { at, out: { x: out.x / across, y: out.y / across } };
}

/** Where an edge meets `item`'s `side`: the side's middle, as `terminalAt` reads it. */
export function sideTerminal(item: CanvasNode, side: CanvasSide = "right"): EdgeTerminal {
  return terminalAt(item, SIDE_ANCHORS[side]);
}

/** Where an edge's `end` meets `item`, its anchor read as `terminalAt` reads it. */
function endTerminal(item: CanvasNode, edge: CanvasEdge, end: EdgeEnd): EdgeTerminal {
  return terminalAt(item, anchorOf(edge, end));
}

const third = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;

/**
 * The anchor of `item`'s box under canvas point `point`, to a thousandth:
 * where a drop lands an end precisely (`terminalAt` carries it onto the
 * outline from there).
 */
export function anchorNear(item: CanvasNode, point: { x: number; y: number }): CanvasAnchor {
  const frame = boxFrame(item);
  const local = boxToLocal(frame, { x: point.x, y: point.y, z: frame.centre.z });
  return {
    x: third((local.x / (frame.half.x || 1) + 1) / 2),
    y: third((local.y / (frame.half.y || 1) + 1) / 2),
  };
}

/** The side an anchor lies nearest: the JSON Canvas side written beside it, its coarse form. */
function sideOf(anchor: CanvasAnchor): CanvasSide {
  const reach: readonly [CanvasSide, number][] = [
    ["left", anchor.x],
    ["right", 1 - anchor.x],
    ["top", anchor.y],
    ["bottom", 1 - anchor.y],
  ];
  return reach.reduce((best, next) => (next[1] < best[1] ? next : best))[0];
}

/**
 * `edge` with its `end` meeting its item at `anchor` (undefined: at its
 * side's middle, with `side`, or the default side): the anchor kb reads,
 * and the side nearest it, which other JSON Canvas readers keep. One set
 * here supersedes a value this version could not read.
 */
export function withEnd(
  edge: CanvasEdge,
  end: EdgeEnd,
  at: { readonly anchor?: CanvasAnchor; readonly side?: CanvasSide },
): CanvasEdge {
  const anchorKey = end === "from" ? "fromAnchor" : "toAnchor";
  const sideKey = end === "from" ? "fromSide" : "toSide";
  const next: CanvasEdge = dropExtra(dropExtra({ ...edge }, anchorKey), sideKey);
  delete next[anchorKey];
  const side = at.anchor === undefined ? at.side : sideOf(at.anchor);
  if (at.anchor !== undefined) next[anchorKey] = at.anchor;
  if (side === undefined) delete next[sideKey];
  else next[sideKey] = side;
  return next;
}

/** Each side, and the side a mirror along each floor axis makes of it. */
const MIRRORED_SIDES: { readonly [A in "x" | "y"]: { readonly [S in CanvasSide]: CanvasSide } } = {
  x: { left: "right", right: "left", top: "top", bottom: "bottom" },
  y: { left: "left", right: "right", top: "bottom", bottom: "top" },
};

/**
 * `edge` with its `end` meeting its item where it did once the item is
 * mirrored along `axis` (`reflectItem`): its anchor, or its side, mirrored
 * across the item's box.
 */
function mirroredEnd(edge: CanvasEdge, end: EdgeEnd, axis: "x" | "y"): CanvasEdge {
  const anchor = end === "from" ? edge.fromAnchor : edge.toAnchor;
  if (anchor !== undefined) {
    const mirrored =
      axis === "x" ? { x: 1 - anchor.x, y: anchor.y } : { x: anchor.x, y: 1 - anchor.y };
    return withEnd(edge, end, { anchor: mirrored });
  }
  const side = (end === "from" ? edge.fromSide : edge.toSide) ?? DEFAULT_SIDES[end];
  return withEnd(edge, end, { side: MIRRORED_SIDES[axis][side] });
}

/** Whether an end faces across the canvas (along x) rather than up or down it. */
const across = (t: EdgeTerminal) => Math.abs(t.out.x) >= Math.abs(t.out.y);

/** How far an arc bows: its `bend`, or a fifth of the way across when it has none. */
const arcBend = (edge: CanvasEdge, chord: number) => edge.bend ?? chord / 5;

/**
 * The axis an elbow's middle run is moved along by its `bend`: across when
 * both its ends face across, down when both face up or down; none when
 * they meet at one corner, which no bend moves.
 */
function elbowBendAxis(a: EdgeTerminal, b: EdgeTerminal): "x" | "y" | null {
  if (across(a) && across(b)) return "x";
  if (!across(a) && !across(b)) return "y";
  return null;
}

/**
 * `edge` bowed as it did once both its items, `from` and `to`, are
 * mirrored along `axis`: a mirror turns left of travel into right, so an
 * arc's bend is negated (its default written out), and so is an elbow's
 * when its middle run moves along that axis. Read before the mirror.
 */
function mirroredBend(
  edge: CanvasEdge,
  axis: "x" | "y",
  from: CanvasNode,
  to: CanvasNode,
): CanvasEdge {
  const a = endTerminal(from, edge, "from");
  const b = endTerminal(to, edge, "to");
  if (edge.route === "arc") {
    const chord = Math.hypot(b.at.x - a.at.x, b.at.y - a.at.y);
    return withRoute(edge, { bend: -arcBend(edge, chord) });
  }
  if (edge.route === "elbow" && edge.bend !== undefined && elbowBendAxis(a, b) === axis) {
    return withRoute(edge, { bend: -edge.bend });
  }
  return edge;
}

/**
 * `edge` running as it did once the items `mirrored` names among its ends
 * are mirrored along `axis` (`reflectItem`), each read as it stood: each
 * such end meets its item where it did (`mirroredEnd`), and an edge
 * mirrored whole bows the mirrored way (`mirroredBend`).
 */
export function mirroredEdge(
  edge: CanvasEdge,
  axis: "x" | "y",
  mirrored: { readonly from: CanvasNode | undefined; readonly to: CanvasNode | undefined },
): CanvasEdge {
  const { from, to } = mirrored;
  const bent = from !== undefined && to !== undefined ? mirroredBend(edge, axis, from, to) : edge;
  const fromMet = from === undefined ? bent : mirroredEnd(bent, "from", axis);
  return to === undefined ? fromMet : mirroredEnd(fromMet, "to", axis);
}

/** A point `reach` out of the side `terminal` faces: a curve's control there. */
function leaving(terminal: EdgeTerminal, reach: number): { x: number; y: number } {
  return {
    x: terminal.at.x + terminal.out.x * reach,
    y: terminal.at.y + terminal.out.y * reach,
  };
}

/** The route an edge runs, in canvas units: the path the top view draws, and its two ends. */
export interface EdgeRoute {
  /** Path data across the floor, as the shape table speaks it (`CanvasPathCommand`). */
  readonly path: readonly CanvasPathCommand[];
  readonly from: EdgeTerminal;
  readonly to: EdgeTerminal;
}

/** How far a curve's controls reach out of its ends for a span `dx` across, canvas units. */
function curveReach(dx: number): number {
  return Math.max(40, Math.abs(dx) * 0.45);
}

type Pt = { readonly x: number; readonly y: number };

/** A cubic between two ends, its controls out along their sides: JSON Canvas's own curve. */
function curvePath(a: EdgeTerminal, b: EdgeTerminal): CanvasPathCommand[] {
  const reach = curveReach(b.at.x - a.at.x);
  const c1 = leaving(a, reach);
  const c2 = leaving(b, reach);
  return [
    ["M", a.at.x, a.at.y],
    ["C", c1.x, c1.y, c2.x, c2.y, b.at.x, b.at.y],
  ];
}

/**
 * An arc from `a` to `b` whose middle stands `bend` off the straight line,
 * to the left of the way it runs as the top view shows it (a negative bend
 * to the right): a quadratic through that point, written as a cubic.
 */
function arcPath(a: Pt, b: Pt, bend: number): CanvasPathCommand[] {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const chord = Math.hypot(dx, dy) || 1;
  // Left of travel with y down the page: the direction turned a quarter anticlockwise on screen.
  const left = { x: dy / chord, y: -dx / chord };
  const q = { x: (a.x + b.x) / 2 + left.x * bend * 2, y: (a.y + b.y) / 2 + left.y * bend * 2 };
  const c1 = { x: a.x + ((q.x - a.x) * 2) / 3, y: a.y + ((q.y - a.y) * 2) / 3 };
  const c2 = { x: b.x + ((q.x - b.x) * 2) / 3, y: b.y + ((q.y - b.y) * 2) / 3 };
  return [
    ["M", a.x, a.y],
    ["C", c1.x, c1.y, c2.x, c2.y, b.x, b.y],
  ];
}

/**
 * An elbow: runs along the canvas's axes only, leaving and arriving along
 * the axis each side faces. Two ends that face the same way across meet by
 * a middle run between them, moved `bend` off centre; ends that face
 * different ways meet at one corner.
 */
function elbowPath(a: EdgeTerminal, b: EdgeTerminal, bend: number): CanvasPathCommand[] {
  const [p, q] = [a.at, b.at];
  const moved = elbowBendAxis(a, b);
  const corners: Pt[] =
    moved === "x"
      ? [
          { x: (p.x + q.x) / 2 + bend, y: p.y },
          { x: (p.x + q.x) / 2 + bend, y: q.y },
        ]
      : moved === "y"
        ? [
            { x: p.x, y: (p.y + q.y) / 2 + bend },
            { x: q.x, y: (p.y + q.y) / 2 + bend },
          ]
        : across(a)
          ? [{ x: q.x, y: p.y }]
          : [{ x: p.x, y: q.y }];
  return [["M", p.x, p.y], ...corners.map((c) => ["L", c.x, c.y] as const), ["L", q.x, q.y]];
}

/**
 * The route `edge` runs from item `from` to item `to`, between the points
 * its ends meet (`anchorOf`), as its `route` says: a `curve` (JSON Canvas's,
 * the default) out along each end's side, `straight`, an `arc` bowed by
 * `bend` (a fifth of the way across when it has none), or an `elbow` along
 * the canvas's axes, its middle run moved by `bend`.
 */
export function edgeRoute(from: CanvasNode, to: CanvasNode, edge: CanvasEdge): EdgeRoute {
  const a = endTerminal(from, edge, "from");
  const b = endTerminal(to, edge, "to");
  const chord = Math.hypot(b.at.x - a.at.x, b.at.y - a.at.y);
  switch (edge.route) {
    case "straight":
      return {
        path: [
          ["M", a.at.x, a.at.y],
          ["L", b.at.x, b.at.y],
        ],
        from: a,
        to: b,
      };
    case "arc":
      return { path: arcPath(a.at, b.at, arcBend(edge, chord)), from: a, to: b };
    case "elbow":
      return { path: elbowPath(a, b, edge.bend ?? 0), from: a, to: b };
    case "curve":
    case undefined:
    default:
      return { path: curvePath(a, b), from: a, to: b };
  }
}

/** A change of how an edge runs: each named part set, or to undefined to go back to its default. */
export interface EdgeRoutePatch {
  readonly route?: CanvasRoute | undefined;
  readonly bend?: number | undefined;
}

/**
 * `edge` running as `patch` says. JSON Canvas's curve, and no bend, are
 * written as no field; one set here supersedes a value this version could
 * not read.
 */
export function withRoute(edge: CanvasEdge, patch: EdgeRoutePatch): CanvasEdge {
  let next: CanvasEdge = { ...edge };
  if ("route" in patch) {
    next = dropExtra(next, "route");
    if (patch.route === undefined || patch.route === "curve") delete next.route;
    else next.route = patch.route;
  }
  if ("bend" in patch) {
    next = dropExtra(next, "bend");
    if (patch.bend === undefined) delete next.bend;
    else next.bend = patch.bend;
  }
  return next;
}

/**
 * A drag's route from `terminal` to a loose point `end` under the pointer:
 * the curve's first control out of its side, the second on the point.
 */
export function looseRoute(terminal: EdgeTerminal, end: { x: number; y: number }): EdgeRoute {
  const c1 = leaving(terminal, curveReach(end.x - terminal.at.x));
  return {
    path: [
      ["M", terminal.at.x, terminal.at.y],
      ["C", c1.x, c1.y, end.x, end.y, end.x, end.y],
    ],
    from: terminal,
    to: { at: { x: end.x, y: end.y, z: terminal.at.z }, out: { x: 0, y: 0 } },
  };
}

/** Smoothstep: an ease from 0 to 1 that leaves and arrives level. */
const ease = (t: number) => t * t * (3 - 2 * t);

/** The running length along `points` at each of them, across the floor. */
function runningLengths(points: readonly Pt[]): number[] {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    lengths.push((lengths[i - 1] ?? 0) + (a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0));
  }
  return lengths;
}

/**
 * Points along a route in canvas space, its curves flattened: across the
 * floor as the path runs, climbing from one end's height to the other's,
 * level as it leaves and as it arrives. What a renderer that draws lines
 * draws, and where a head or a label sits.
 */
export function routePoints(route: EdgeRoute): CanvasVec[] {
  const flat = outlinePoints(route.path).map(([x, y]) => ({ x, y }));
  const lengths = runningLengths(flat);
  const total = Math.max(lengths.at(-1) ?? 0, 1e-9);
  const za = route.from.at.z;
  const zb = route.to.at.z;
  return flat.map(({ x, y }, i) => ({
    x,
    y,
    z: za + (zb - za) * ease((lengths[i] ?? 0) / total),
  }));
}

/** The point halfway along a route, across the floor: where an edge's label stands. */
export function routeMidpoint(route: EdgeRoute): { x: number; y: number } {
  const points = routePoints(route);
  const lengths = runningLengths(points);
  const half = (lengths.at(-1) ?? 0) / 2;
  const i = Math.max(
    1,
    lengths.findIndex((l) => l >= half),
  );
  const a = points[i - 1] ?? route.from.at;
  const b = points[i] ?? route.to.at;
  const span = (lengths[i] ?? 0) - (lengths[i - 1] ?? 0);
  const t = span > 0 ? (half - (lengths[i - 1] ?? 0)) / span : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * The head an edge's `end` wears, or null for none. JSON Canvas's
 * `fromEnd`/`toEnd` says whether it wears one (none leaving, an arrow
 * arriving, by default), kb's `fromHead`/`toHead` which: JSON Canvas's
 * arrow when it names none.
 */
export function headOf(edge: CanvasEdge, end: EdgeEnd): CanvasHead | null {
  if (end === "from") return edge.fromEnd === "arrow" ? (edge.fromHead ?? "arrow") : null;
  return edge.toEnd === "none" ? null : (edge.toHead ?? "arrow");
}

/**
 * `edge` with its `end` wearing `head`, or none (null): its JSON Canvas end
 * written as the coarse form other readers keep (`arrow` for any head), and
 * the head named only when it is not JSON Canvas's own arrow. A default is
 * written as no field, and one set here supersedes a value this version
 * could not read.
 */
export function withHead(edge: CanvasEdge, end: EdgeEnd, head: CanvasHead | null): CanvasEdge {
  const endKey = end === "from" ? "fromEnd" : "toEnd";
  const headKey = end === "from" ? "fromHead" : "toHead";
  const next: CanvasEdge = dropExtra(dropExtra({ ...edge }, endKey), headKey);
  delete next[headKey];
  const wears = head !== null;
  // JSON Canvas: an edge leaves bare and arrives with an arrow unless it says otherwise.
  const defaultWears = end === "to";
  if (wears === defaultWears) delete next[endKey];
  else next[endKey] = wears ? "arrow" : "none";
  if (head !== null && head !== "arrow") next[headKey] = head;
  return next;
}

/** A head as drawn: its kind, its outline across the floor in canvas units, and its height. */
export interface EdgeHead {
  readonly kind: CanvasHead;
  readonly path: readonly CanvasPathCommand[];
  /** Filled (an arrow, a dot, a diamond), or stroked as the edge's line is (a chevron, a bar). */
  readonly filled: boolean;
  /** The height of the end it is worn at, which it lies flat at. */
  readonly z: number;
}

/** How a circle of radius `r` about `c` is drawn: four quarter cubics. */
function circlePath(c: Pt, r: number): CanvasPathCommand[] {
  const k = r * 0.5522847498;
  return [
    ["M", c.x + r, c.y],
    ["C", c.x + r, c.y + k, c.x + k, c.y + r, c.x, c.y + r],
    ["C", c.x - k, c.y + r, c.x - r, c.y + k, c.x - r, c.y],
    ["C", c.x - r, c.y - k, c.x - k, c.y - r, c.x, c.y - r],
    ["C", c.x + k, c.y - r, c.x + r, c.y - k, c.x + r, c.y],
    ["Z"],
  ];
}

const move = (p: Pt): CanvasPathCommand => ["M", p.x, p.y];
const line = (p: Pt): CanvasPathCommand => ["L", p.x, p.y];

/**
 * A head of `kind`, `length` long, its tip at `tip` and pointing along the
 * unit direction `dir`, across the floor: JSON Canvas's filled `arrow`, an
 * `open` chevron, a `dot`, a `diamond`, or a `bar` across the end.
 */
function headPath(kind: CanvasHead, tip: Pt, dir: Pt, length: number): CanvasPathCommand[] {
  // `back` along the head from its tip, `side` across it (left of the way it points).
  const point = (back: number, side: number) => ({
    x: tip.x - dir.x * back - dir.y * side,
    y: tip.y - dir.y * back + dir.x * side,
  });
  const half = length * 0.45;
  switch (kind) {
    case "open":
      return [move(point(length, half)), line(tip), line(point(length, -half))];
    case "dot":
      return circlePath(point(length / 2, 0), length * 0.35);
    case "diamond":
      return [
        move(tip),
        line(point(length / 2, half)),
        line(point(length, 0)),
        line(point(length / 2, -half)),
        ["Z"],
      ];
    case "bar":
      return [move(point(0, half)), line(point(0, -half))];
    case "arrow":
    default:
      return [move(tip), line(point(length, half)), line(point(length, -half)), ["Z"]];
  }
}

/** Which heads are stroked, as the line is, rather than filled. */
const STROKED_HEADS: ReadonlySet<CanvasHead> = new Set(["open", "bar"]);

/**
 * The head of `kind` worn at `end` of the line through `points`, `length`
 * long: its tip on the end's point, pointing the way the line runs into it
 * (out of the line at the end it leaves). Null for a line of one point.
 */
export function headOnLine(
  kind: CanvasHead,
  points: readonly CanvasVec[],
  end: EdgeEnd,
  length: number,
): EdgeHead | null {
  const [tip, before] = end === "to" ? [points.at(-1), points.at(-2)] : [points[0], points[1]];
  if (tip === undefined || before === undefined) return null;
  const span = Math.hypot(tip.x - before.x, tip.y - before.y) || 1;
  const dir = { x: (tip.x - before.x) / span, y: (tip.y - before.y) / span };
  return {
    kind,
    path: headPath(kind, tip, dir, length),
    filled: !STROKED_HEADS.has(kind),
    z: tip.z,
  };
}

/**
 * The head `edge`'s `end` wears on `route`, `length` long, or null for
 * none (`headOnLine`). Both projections draw this outline: the DOM as a
 * path, the scene flat at the end's height.
 */
export function edgeHead(
  edge: CanvasEdge,
  route: EdgeRoute,
  end: EdgeEnd,
  length: number,
): EdgeHead | null {
  const kind = headOf(edge, end);
  return kind === null ? null : headOnLine(kind, routePoints(route), end, length);
}
