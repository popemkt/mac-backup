/**
 * The 3D canvas's mesh builders: the three side of the shape table
 * (`CANVAS_SHAPES` in `@kb/canvas`, plan 2026-10-02 decision 6). An item's
 * geometry is built at its own size, in its own frame — the origin at the
 * centre of its footprint on its base, x to the right, y up the top view
 * (three's y, canvas y flipped) and z up — so the scene only places it.
 *
 * - A **flat** item is its footprint: the outline the top view draws, as a
 *   cap facing up.
 * - A **solid** is the volume its shape names, one builder per volume
 *   ({@link VOLUME_BUILDERS}, typed by `CanvasVolume`, so a volume with no
 *   builder does not type-check, and a shape cannot lack one because the
 *   table names a volume for every shape): the footprint carried straight up
 *   (a prism), the ellipsoid its box bounds, or a cone.
 *
 * Every geometry has up to three groups, which the scene gives materials by
 * index: {@link FACE} (the top cap, faced with the card), {@link BODY} (the
 * sides and the bottom). Each builder also gives its **edges** — the lines
 * that draw the solid's outline as a diagram would: a prism's top and base
 * outlines and its creases, a cone's base, a flat item's outline (so a flat
 * item seen edge-on is still a line, not nothing), and a sphere's equator,
 * which only the selection draws.
 */
import {
  BufferGeometry,
  ConeGeometry,
  Float32BufferAttribute,
  ShapeUtils,
  SphereGeometry,
  Vector2,
} from "three/webgpu";
import {
  CANVAS_SHAPES,
  shapeOutline,
  tracePath,
  type CanvasPathSink,
  type CanvasShapeKind,
  type CanvasVolume,
} from "@kb/canvas";

/** Material slots: the face on top, the body everywhere else. */
export const FACE = 0;
export const BODY = 1;

/** What an item's geometry is built from: its shape, box and corner radius. */
export interface SolidSpec {
  readonly shape: CanvasShapeKind;
  readonly width: number;
  readonly height: number;
  /** 0 is flat. */
  readonly depth: number;
  /** A rectangle's corner radius, the look's (`readCardLook`). */
  readonly radius: number;
  /**
   * How far the face texture reaches past the footprint on each side, in
   * canvas units (`FACE_MARGIN`): the top cap's UVs land the card inside it.
   */
  readonly faceMargin: number;
}

export interface SolidGeometry {
  readonly geometry: BufferGeometry;
  /** Line segments in the same frame, as pairs of points (x, y, z each). */
  readonly edges: readonly number[];
  /** Whether the edges are drawn only while the item is selected. */
  readonly edgesWhenSelected: boolean;
}

/** A point on the outline in the item's frame, and the outward normal of the side it starts. */
type Ring = readonly (readonly [number, number])[];

/** How far apart the points a curve is flattened into may be, canvas units. */
const CURVE_STEP = 6;
/** Sides meeting at more than this turn (radians) keep a hard edge; gentler ones are smoothed. */
const CREASE = (35 * Math.PI) / 180;

/** Collects an outline as a closed ring of points, curves flattened. */
class RingSink implements CanvasPathSink {
  readonly points: [number, number][] = [];

  moveTo(x: number, y: number): void {
    this.points.push([x, y]);
  }

  lineTo(x: number, y: number): void {
    this.points.push([x, y]);
  }

  // oxlint-disable-next-line max-params -- the canvas 2D context's own signature, which a sink speaks
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    const [x0, y0] = this.points.at(-1) ?? [x, y];
    const reach = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(
      2,
      Math.min(24, Math.ceil((reach + Math.hypot(x - x2, y - y2)) / CURVE_STEP)),
    );
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      this.points.push([
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
      ]);
    }
  }

  closePath(): void {}
}

/**
 * The footprint's outline as a ring in the item's frame (y up), counter-
 * clockwise seen from above, with no repeated closing point.
 */
function footprintRing(spec: SolidSpec): Ring {
  const sink = new RingSink();
  const { width: w, height: h } = spec;
  tracePath(sink, shapeOutline(spec.shape, w, h, spec.radius), (x, y) => [x - w / 2, h / 2 - y]);
  const ring = sink.points.filter((p, i, all) => {
    const next = all[(i + 1) % all.length];
    return next === undefined || Math.hypot(next[0] - p[0], next[1] - p[1]) > 1e-6;
  });
  // An outline runs clockwise on screen; with y flipped up, that is clockwise from above too.
  return ring.toReversed();
}

/** Accumulates triangles with positions, normals and UVs, group by group. */
class Builder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly groups: { start: number; count: number; slot: number }[] = [];

  vertex(p: readonly number[], n: readonly number[], uv: readonly [number, number]): void {
    this.positions.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
    this.normals.push(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0);
    this.uvs.push(uv[0], uv[1]);
  }

  /** Every vertex added inside `draw` belongs to material `slot`. */
  group(slot: number, draw: () => void): void {
    const start = this.positions.length / 3;
    draw();
    const count = this.positions.length / 3 - start;
    if (count > 0) this.groups.push({ start, count, slot });
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(this.uvs, 2));
    for (const { start, count, slot } of this.groups) geometry.addGroup(start, count, slot);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Where a footprint point falls on the face texture, which reaches `faceMargin` past it. */
function faceUv(spec: SolidSpec, [x, y]: readonly [number, number]): [number, number] {
  const m = spec.faceMargin;
  return [
    (x + spec.width / 2 + m) / (spec.width + m * 2),
    (y + spec.height / 2 + m) / (spec.height + m * 2),
  ];
}

/** The ring as a cap at height `z`, facing up (or down), triangulated. */
function cap(builder: Builder, spec: SolidSpec, ring: Ring, z: number, up: boolean): void {
  const contour = ring.map(([x, y]) => new Vector2(x, y));
  const triangles = ShapeUtils.triangulateShape(contour, []);
  const normal = [0, 0, up ? 1 : -1];
  for (const triangle of triangles) {
    const [a = [0, 0], b = [0, 0], c = [0, 0]] = triangle.map((index) => ring[index]);
    // Counter-clockwise seen from where the cap faces, whatever order the triangulation chose.
    const ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
    const order = ccw === up ? triangle : triangle.toReversed();
    for (const index of order) {
      const p = ring[index] ?? [0, 0];
      builder.vertex([p[0], p[1], z], normal, faceUv(spec, p));
    }
  }
}

/** A closed loop of line segments through `ring` at height `z`. */
function loop(ring: Ring, z: number): number[] {
  return ring.flatMap(([x, y], i) => {
    const [nx, ny] = ring[(i + 1) % ring.length] ?? [x, y];
    return [x, y, z, nx, ny, z];
  });
}

// A flat item has no thickness: from any tilt its outline draws it, but
// exactly level (the front and side presets) it is a hairline on its plane.
// GAP [[01M41AB7YM5801ZJNM1Q647SYD]]
const flat = (spec: SolidSpec): SolidGeometry => {
  const ring = footprintRing(spec);
  const builder = new Builder();
  builder.group(FACE, () => cap(builder, spec, ring, 0, true));
  return { geometry: builder.build(), edges: loop(ring, 0), edgesWhenSelected: false };
};

/**
 * The footprint carried up `depth`: the face on top, and sides whose normals
 * are smoothed round curves and kept hard at corners (the diamond's points),
 * where an edge line is drawn too.
 */
const prism = (spec: SolidSpec): SolidGeometry => {
  const ring = footprintRing(spec);
  const d = spec.depth;
  const n = ring.length;
  // Each side's outward normal (the ring runs counter-clockwise).
  const sides = ring.map(([x, y], i) => {
    const [nx, ny] = ring[(i + 1) % n] ?? [x, y];
    const len = Math.hypot(nx - x, ny - y) || 1;
    return [(ny - y) / len, -(nx - x) / len] as const;
  });
  const creased = ring.map((_, i) => {
    const a = sides[(i - 1 + n) % n] ?? [0, 0];
    const b = sides[i] ?? [0, 0];
    return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) > CREASE;
  });
  /** The normal side `i` has at its corner `corner` (its start or its end). */
  const normalAt = (i: number, corner: number): readonly [number, number] => {
    const own = sides[i] ?? [0, 0];
    if (creased[corner] === true) return own;
    const before = sides[(corner - 1 + n) % n] ?? own;
    const after = sides[corner] ?? own;
    const sx = before[0] + after[0];
    const sy = before[1] + after[1];
    const len = Math.hypot(sx, sy) || 1;
    return [sx / len, sy / len];
  };
  const builder = new Builder();
  builder.group(FACE, () => cap(builder, spec, ring, d, true));
  builder.group(BODY, () => {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = ring[i] ?? [0, 0];
      const b = ring[j] ?? [0, 0];
      const na = normalAt(i, i);
      const nb = normalAt(i, j);
      const quad: [readonly number[], readonly [number, number]][] = [
        [[a[0], a[1], 0], na],
        [[b[0], b[1], 0], nb],
        [[b[0], b[1], d], nb],
        [[a[0], a[1], 0], na],
        [[b[0], b[1], d], nb],
        [[a[0], a[1], d], na],
      ];
      for (const [p, nn] of quad) builder.vertex(p, [nn[0], nn[1], 0], [0, 0]);
    }
    cap(builder, spec, ring, 0, false);
  });
  const creases = ring.flatMap(([x, y], i) => (creased[i] === true ? [x, y, 0, x, y, d] : []));
  return {
    geometry: builder.build(),
    edges: [...loop(ring, d), ...loop(ring, 0), ...creases],
    edgesWhenSelected: false,
  };
};

/** A three primitive (unit, axis up y) stood on z, scaled to the box, as the body. */
function primitive(source: BufferGeometry, spec: SolidSpec): BufferGeometry {
  source.rotateX(Math.PI / 2);
  source.translate(0, 0, 0.5);
  source.scale(spec.width, spec.height, spec.depth);
  source.clearGroups();
  const count = source.index?.count ?? source.getAttribute("position").count;
  source.addGroup(0, count, BODY);
  source.computeBoundingBox();
  source.computeBoundingSphere();
  return source;
}

/** An ellipse of `segments` points round the footprint at height `z`, as a loop. */
function ellipseLoop(spec: SolidSpec, z: number, segments = 64): number[] {
  const ring: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    ring.push([(Math.cos(a) * spec.width) / 2, (Math.sin(a) * spec.height) / 2]);
  }
  return loop(ring, z);
}

const VOLUME_BUILDERS: { readonly [V in CanvasVolume]: (spec: SolidSpec) => SolidGeometry } = {
  prism,
  // An ellipsoid and a cone have no flat top to wear the card on, so their
  // label is not drawn in 3D until labels are billboards (plan step 7).
  // GAP [[01M41GAZJS5TD86RFSAJJB4XKD]]
  ellipsoid: (spec) => ({
    geometry: primitive(new SphereGeometry(0.5, 64, 40), spec),
    edges: ellipseLoop(spec, spec.depth / 2),
    edgesWhenSelected: true,
  }),
  cone: (spec) => ({
    geometry: primitive(new ConeGeometry(0.5, 1, 64, 1), spec),
    edges: ellipseLoop(spec, 0),
    edgesWhenSelected: false,
  }),
};

/** An item's geometry: its footprint when flat, otherwise the volume its shape fills. */
export function solidGeometry(spec: SolidSpec): SolidGeometry {
  if (spec.depth <= 0) return flat(spec);
  return VOLUME_BUILDERS[CANVAS_SHAPES[spec.shape].volume](spec);
}

/** Everything a geometry is built from, as a key: rebuilt exactly when it changes. */
export function solidKey(spec: SolidSpec): string {
  return `${spec.shape}|${spec.width}|${spec.height}|${spec.depth}|${spec.radius}|${spec.faceMargin}`;
}
