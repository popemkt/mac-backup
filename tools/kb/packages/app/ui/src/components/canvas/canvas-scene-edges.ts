/**
 * The 3D canvas's edges (`canvas-scene`): lines between the items' side
 * anchors, bowed like their 2D bezier and climbing from one height to the
 * other, with a cone for an arrowhead. An edge is rebuilt only when what it
 * is drawn from changes (`edgeVersion`: its ends' boxes and heights, sides,
 * arrowheads, colour and selection); a drag rebuilds just the edges of the
 * cards it carries.
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
import type { CanvasEdge, CanvasNode } from "@kb/canvas";
import { leaving, sideAnchor, type SideAnchor } from "./canvas-edge-path";
import type { CardLook } from "./canvas-card-face";
import type { CanvasSceneContent } from "./canvas-scene-content";

const SAMPLES = 28;
const UP = new Vector3(0, 1, 0);

/** The two side anchors an edge runs between (`sideAnchor`): where it starts and ends. */
function anchorsOf(from: CanvasNode, to: CanvasNode, edge: CanvasEdge) {
  return [
    sideAnchor(from, edge.fromSide ?? "right"),
    sideAnchor(to, edge.toSide ?? "left"),
  ] as const;
}

/** The edge's curve in three's space: the 2D bezier, climbing smoothly between the two heights. */
function edgeCurve([from, to]: readonly [SideAnchor, SideAnchor]): Vector3[] {
  const a = from.at;
  const b = to.at;
  const za = a.z;
  const zb = b.z;
  const reach = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.4);
  const c1 = leaving(from, reach);
  const c2 = leaving(to, reach);
  const points: Vector3[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const u = 1 - t;
    const x = u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x;
    const y = u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y;
    const z = za + (zb - za) * t * t * (3 - 2 * t);
    points.push(new Vector3(x, -y, z + 0.5));
  }
  return points;
}

const anchorKey = ({ at, out }: SideAnchor) => `${at.x},${at.y},${at.z},${out.x},${out.y}`;

/** Everything an edge is drawn from, as a version: its anchors, ends, colour and selection. */
function edgeVersion(
  edge: CanvasEdge,
  [from, to]: readonly [SideAnchor, SideAnchor],
  selected: boolean,
) {
  const ends = `${edge.fromEnd ?? ""}>${edge.toEnd ?? ""}`;
  return `${anchorKey(from)}|${anchorKey(to)}|${ends}|${edge.color ?? ""}|${selected ? "s" : "-"}`;
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
      const anchors = anchorsOf(from, to, edge);
      const version = edgeVersion(edge, anchors, selected);
      if (this.drawn.get(edge.id)?.version === version) continue;
      this.drop(edge.id);
      const group = this.draw(edge, edgeCurve(anchors), selected);
      this.root.add(group);
      this.drawn.set(edge.id, { group, version });
    }
    const kept = new Set(ids);
    for (const id of this.drawn.keys()) if (!kept.has(id)) this.drop(id);
    this.ids = ids;
  }

  dispose(): void {
    for (const id of this.drawn.keys()) this.drop(id);
    this.cone.dispose();
  }

  private colorOf(edge: CanvasEdge, selected: boolean): Color {
    const { look } = this;
    if (selected) return new Color(look.primary);
    const preset = edge.color === undefined ? undefined : (look.presets[edge.color] ?? edge.color);
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
