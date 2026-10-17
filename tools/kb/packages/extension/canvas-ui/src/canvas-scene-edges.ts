/**
 * The 3D canvas's edges (`canvas-scene`): each a line through its route's
 * points (`edgeRoute`, `routePoints`, `@kb/canvas`) — the path the 2D canvas
 * draws, climbing from one end's height to the other — stroked as its look
 * says (`edgePaint`), with the heads its ends wear (`edgeHead`) laid flat at
 * their ends' heights: the outlines the 2D canvas draws. An edge is rebuilt
 * only when what it is drawn from changes (`edgeVersion`); a drag rebuilds
 * just the edges of the cards it carries.
 */
import {
  Color,
  DoubleSide,
  Group,
  Line2NodeMaterial,
  Mesh,
  MeshBasicNodeMaterial,
  NormalBlending,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from "three/webgpu";
import { Line2 } from "three/addons/lines/webgpu/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import {
  CANVAS_HEADS,
  edgeHead,
  edgeRoute,
  outlinePoints,
  routePoints,
  type CanvasEdge,
  type CanvasHead,
  type EdgeEnd,
  type EdgeHead,
  type EdgeRoute,
  edgePaint,
  type EdgePaint,
  type EdgeState,
} from "@kb/canvas";
import { edgeUnbound } from "./canvas-api";
import { toneColor, type CardLook } from "./canvas-card-face";
import type { CanvasSceneContent } from "./canvas-scene-content";

/** An edge runs a hair over the planes it joins, so a flat card never covers it. */
const LIFT = 0.5;

type Point = { x: number; y: number };

/** An edge as drawn, read back: its line, its opacity and its heads, in canvas space. */
export interface DrawnEdge {
  /** The points its line runs through, across the floor. */
  readonly points: readonly Point[];
  /** Its line's dash pattern, width and colour (`#rrggbb`); null when no line is drawn. */
  readonly line: {
    readonly pattern: readonly number[];
    readonly width: number;
    readonly color: string;
  } | null;
  readonly opacity: number;
  readonly heads: readonly {
    readonly end: EdgeEnd;
    readonly kind: CanvasHead;
    readonly filled: boolean;
    readonly points: readonly Point[];
    readonly color: string;
  }[];
}

/** How a line is stroked: its dash pattern (empty: unbroken), its width and its opacity. */
interface Stroke {
  readonly pattern: readonly number[];
  readonly width: number;
  readonly opacity: number;
}

/** The route's points in three's space (canvas y flipped), a hair over its planes. */
function edgeCurve(route: EdgeRoute): Vector3[] {
  return routePoints(route).map((p) => new Vector3(p.x, -p.y, p.z + LIFT));
}

/** Everything an edge is drawn from, as a version: its route, its heads and looks, and how it stands. */
function edgeVersion(edge: CanvasEdge, route: EdgeRoute, state: EdgeState) {
  const heads = [edge.fromEnd, edge.fromHead, edge.toEnd, edge.toHead];
  const drawn = [route.path, route.from.at.z, route.to.at.z, heads, edge.color, edge.style];
  return JSON.stringify([drawn, state.selected, state.unbound]);
}

/** A line's points in canvas space, read from its own geometry (three's y flipped back). */
function linePoints(line: Line2): Point[] {
  const start = line.geometry.getAttribute("instanceStart");
  const end = line.geometry.getAttribute("instanceEnd");
  const points = Array.from({ length: start.count }, (_, i) => ({
    x: start.getX(i),
    y: -start.getY(i),
  }));
  const last = end.count - 1;
  if (last >= 0) points.push({ x: end.getX(last), y: -end.getY(last) });
  return points;
}

/** A filled head's outline in canvas space, read from its mesh's vertices. */
function meshPoints(mesh: Mesh): Point[] {
  const position = mesh.geometry.getAttribute("position");
  return Array.from({ length: position.count }, (_, i) => ({
    x: position.getX(i),
    y: -position.getY(i),
  }));
}

/**
 * The material a line is drawn with. A translucent one blends over what is
 * behind it, which a line's material does not do by default.
 */
function lineMaterial(color: Color, { pattern, width, opacity }: Stroke): Line2NodeMaterial {
  const [dashSize, gapSize] = pattern;
  return new Line2NodeMaterial({
    color,
    linewidth: width,
    dashed: dashSize !== undefined,
    ...(dashSize === undefined ? {} : { dashSize, gapSize: gapSize ?? dashSize }),
    ...(opacity < 1
      ? { transparent: true, opacity, blending: NormalBlending, depthWrite: false }
      : {}),
  });
}

/** A line through `points` (three's space), stroked as `material` says. */
function lineThrough(points: readonly Vector3[], material: Line2NodeMaterial): Line2 {
  const geometry = new LineGeometry();
  geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
  const line = new Line2(geometry, material);
  line.computeLineDistances();
  return line;
}

/** The heads drawn in `group`, read back from their names, geometry and kind of object. */
/** A material's colour as `#rrggbb`, in sRGB as it was given. */
const hexOf = (color: Color) => `#${color.getHexString()}`;

function headsIn(group: Group): DrawnEdge["heads"] {
  return group.children.flatMap((child): DrawnEdge["heads"] => {
    const [, at, named] = child.name.split(":");
    const kind = CANVAS_HEADS.find((k) => k === named);
    if (kind === undefined) return [];
    const end: EdgeEnd = at === "from" ? "from" : "to";
    // A line is a mesh of its segments too: ask it first.
    if (child instanceof Line2) {
      const color = hexOf(child.material.color);
      return [{ end, kind, filled: false, points: linePoints(child), color }];
    }
    if (child instanceof Mesh && child.material instanceof MeshBasicNodeMaterial) {
      const color = hexOf(child.material.color);
      return [{ end, kind, filled: true, points: meshPoints(child), color }];
    }
    return [];
  });
}

interface Drawn {
  readonly group: Group;
  readonly version: string;
}

export class EdgeLayer {
  readonly root = new Group();
  private readonly drawn = new Map<string, Drawn>();
  private look: CardLook;
  ids: readonly string[] = [];

  constructor(look: CardLook) {
    this.look = look;
  }

  /** New colours: every edge is redrawn on the next sync. */
  setLook(look: CardLook): void {
    this.look = look;
    for (const id of this.drawn.keys()) this.drop(id);
  }

  sync(content: CanvasSceneContent): void {
    const byId = new Map(content.doc.nodes.map((n) => [n.id, n]));
    const ids: string[] = [];
    for (const edge of content.doc.edges) {
      const from = byId.get(edge.fromNode);
      const to = byId.get(edge.toNode);
      if (!from || !to) continue;
      ids.push(edge.id);
      const state = {
        selected: content.selection.edgeIds.has(edge.id),
        unbound: edgeUnbound(edge, content.nodes),
      };
      const route = edgeRoute(from, to, edge);
      const version = edgeVersion(edge, route, state);
      if (this.drawn.get(edge.id)?.version === version) continue;
      this.drop(edge.id);
      const group = this.draw(edge, route, edgePaint(edge, state));
      this.root.add(group);
      this.drawn.set(edge.id, { group, version });
    }
    const kept = new Set(ids);
    for (const id of this.drawn.keys()) if (!kept.has(id)) this.drop(id);
    this.ids = ids;
  }

  /** Edge `id` as drawn, read back from its line's and its heads' own geometry and materials. */
  drawnOf(id: string): DrawnEdge | null {
    const group = this.drawn.get(id)?.group;
    const line = group?.children.find((child) => child.name === "line");
    if (group === undefined || !(line instanceof Line2)) return null;
    const { material } = line;
    return {
      points: linePoints(line),
      line: line.visible
        ? {
            pattern: material.dashed ? [material.dashSize, material.gapSize] : [],
            width: material.linewidth,
            color: hexOf(material.color),
          }
        : null,
      opacity: material.transparent ? material.opacity : 1,
      heads: headsIn(group),
    };
  }

  dispose(): void {
    for (const id of this.drawn.keys()) this.drop(id);
  }

  private draw(edge: CanvasEdge, route: EdgeRoute, paint: EdgePaint): Group {
    const color = new Color(toneColor(this.look, paint.ink));
    const group = new Group();
    const pattern = paint.line?.pattern ?? [];
    const line = lineThrough(
      edgeCurve(route),
      lineMaterial(color, { pattern, width: paint.width, opacity: paint.opacity }),
    );
    line.name = "line";
    line.visible = paint.line !== null;
    group.add(line);
    for (const end of ["from", "to"] as const) {
      const head = edgeHead(edge, route, end, paint.headLength);
      if (head !== null) group.add(headObject(head, end, color, paint));
    }
    return group;
  }

  private drop(id: string): void {
    const drawn = this.drawn.get(id);
    if (drawn === undefined) return;
    this.root.remove(drawn.group);
    drawn.group.traverse((child) => {
      if (child instanceof Line2) {
        child.geometry.dispose();
        child.material.dispose();
      } else if (child instanceof Mesh && child.material instanceof MeshBasicNodeMaterial) {
        child.geometry.dispose();
        child.material.dispose();
      }
    });
    this.drawn.delete(id);
  }
}

/** A head laid flat at its end's height: filled as a mesh, or stroked as a line as heavy as the edge's. */
function headObject(head: EdgeHead, end: EdgeEnd, color: Color, paint: EdgePaint): Mesh | Line2 {
  const z = head.z + LIFT;
  const outline = outlinePoints(head.path);
  const name = `head:${end}:${head.kind}`;
  if (!head.filled) {
    const line = lineThrough(
      outline.map(([x, y]) => new Vector3(x, -y, z)),
      lineMaterial(color, { pattern: [], width: paint.width, opacity: paint.opacity }),
    );
    line.name = name;
    return line;
  }
  const translucent = paint.opacity < 1 ? { transparent: true, opacity: paint.opacity } : {};
  const mesh = new Mesh(
    new ShapeGeometry(new Shape(outline.map(([x, y]) => new Vector2(x, -y)))),
    new MeshBasicNodeMaterial({ color, side: DoubleSide, ...translucent }),
  );
  mesh.position.z = z;
  mesh.name = name;
  return mesh;
}
