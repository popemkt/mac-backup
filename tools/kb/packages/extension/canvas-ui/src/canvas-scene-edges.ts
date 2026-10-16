/**
 * The 3D canvas's edges (`canvas-scene`): each a line through its route's
 * points (`edgeRoute`, `routePoints`, `@kb/canvas`) — the path the 2D canvas
 * draws, climbing from one end's height to the other — with a cone for an
 * arrowhead. An edge is rebuilt only when what it is drawn from changes
 * (`edgeVersion`: its route's ends, arrowheads, colour and selection); a
 * drag rebuilds just the edges of the cards it carries.
 */
import {
  Color,
  ConeGeometry,
  Group,
  Line2NodeMaterial,
  Mesh,
  MeshBasicNodeMaterial,
  Quaternion,
  Vector3,
} from "three/webgpu";
import { Line2 } from "three/addons/lines/webgpu/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import {
  edgeRoute,
  routePoints,
  styleOf,
  type CanvasEdge,
  type EdgeRoute,
  type EdgeTerminal,
} from "@kb/canvas";
import { paintColor, type CardLook } from "./canvas-card-face";
import type { CanvasSceneContent } from "./canvas-scene-content";

const UP = new Vector3(0, 1, 0);
/** An edge runs a hair over the planes it joins, so a flat card never covers it. */
const LIFT = 0.5;

/** The route's points in three's space (canvas y flipped), a hair over its planes. */
function edgeCurve(route: EdgeRoute): Vector3[] {
  return routePoints(route).map((p) => new Vector3(p.x, -p.y, p.z + LIFT));
}

const terminalKey = ({ at, out }: EdgeTerminal) => `${at.x},${at.y},${at.z},${out.x},${out.y}`;

/** Everything an edge is drawn from, as a version: its route's ends, heads, colour and selection. */
function edgeVersion(edge: CanvasEdge, route: EdgeRoute, selected: boolean) {
  const ends = `${edge.fromEnd ?? ""}>${edge.toEnd ?? ""}`;
  const at = `${terminalKey(route.from)}|${terminalKey(route.to)}`;
  return `${at}|${ends}|${edge.color ?? ""}|${selected ? "s" : "-"}`;
}

interface DrawnEdge {
  readonly group: Group;
  readonly version: string;
}

export class EdgeLayer {
  readonly root = new Group();
  private readonly cone = new ConeGeometry(4.2, 11, 18);
  private readonly drawn = new Map<string, DrawnEdge>();
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
      const selected = content.selection.edgeIds.has(edge.id);
      const route = edgeRoute(from, to, edge);
      const version = edgeVersion(edge, route, selected);
      if (this.drawn.get(edge.id)?.version === version) continue;
      this.drop(edge.id);
      const group = this.draw(edge, edgeCurve(route), selected);
      this.root.add(group);
      this.drawn.set(edge.id, { group, version });
    }
    const kept = new Set(ids);
    for (const id of this.drawn.keys()) if (!kept.has(id)) this.drop(id);
    this.ids = ids;
  }

  /**
   * Edge `id` as drawn, in canvas space (three's y flipped back): the points
   * its line runs through, read from the line's own geometry.
   */
  pointsOf(id: string): { x: number; y: number; z: number }[] | null {
    const drawn = this.drawn.get(id);
    const line = drawn?.group.children.find((child) => child instanceof Line2);
    if (!(line instanceof Line2)) return null;
    const start = line.geometry.getAttribute("instanceStart");
    const end = line.geometry.getAttribute("instanceEnd");
    const points = Array.from({ length: start.count }, (_, i) => ({
      x: start.getX(i),
      y: -start.getY(i),
      z: start.getZ(i) - LIFT,
    }));
    const last = end.count - 1;
    if (last >= 0) points.push({ x: end.getX(last), y: -end.getY(last), z: end.getZ(last) - LIFT });
    return points;
  }

  dispose(): void {
    for (const id of this.drawn.keys()) this.drop(id);
    this.cone.dispose();
  }

  private colorOf(edge: CanvasEdge, selected: boolean): Color {
    const { look } = this;
    if (selected) return new Color(look.primary);
    const preset = paintColor(look, styleOf(edge).color);
    // At rest an edge is the 2D stroke, composited over the ground.
    return preset === undefined
      ? new Color(look.face).lerp(new Color(look.ink), 0.4)
      : new Color(preset);
  }

  private draw(edge: CanvasEdge, points: readonly Vector3[], selected: boolean): Group {
    const color = this.colorOf(edge, selected);
    const group = new Group();
    const geometry = new LineGeometry();
    geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
    const line = new Line2(
      geometry,
      new Line2NodeMaterial({ color, linewidth: selected ? 2.4 : 1.6 }),
    );
    group.add(line);
    if (edge.toEnd !== "none") group.add(this.arrow(points.at(-1), points.at(-2), color));
    if (edge.fromEnd === "arrow") group.add(this.arrow(points[0], points[1], color));
    return group;
  }

  private arrow(tip: Vector3 | undefined, before: Vector3 | undefined, color: Color): Group {
    const holder = new Group();
    if (tip === undefined || before === undefined) return holder;
    const dir = tip.clone().sub(before).normalize();
    const head = new Mesh(this.cone, new MeshBasicNodeMaterial({ color }));
    head.quaternion.copy(new Quaternion().setFromUnitVectors(UP, dir));
    head.position.copy(tip).addScaledVector(dir, -5.5);
    holder.add(head);
    return holder;
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
        child.material.dispose();
      }
    });
    this.drawn.delete(id);
  }
}
