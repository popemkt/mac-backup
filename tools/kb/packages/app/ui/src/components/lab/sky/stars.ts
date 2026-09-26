/**
 * The Sky's node stars: one sprite drawn once per graph node, standing in
 * the sky's volume (`layout.ts`), and the hovered node's edges drawn as faint
 * constellation lines between stars. A star can be moved (a drag in the
 * Sky); its point and the lines that start at it are rewritten in place,
 * with no allocation per move (P3).
 *
 * A star is sized in the world, so a near one is larger and a far one
 * smaller (size attenuation, L3) — scaled with its depth so a constellation
 * at the back of the sky still reads — and it kindles on arrival in a seeded
 * order.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  LineBasicNodeMaterial,
  LineSegments,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
} from "three/webgpu";
import { float, instancedBufferAttribute, instanceIndex, length, select, sin } from "three/tsl";
import type { LabGraph, LabNode } from "@/components/lab/lab-graph";
import type { Entrance } from "@/components/lab/kit/entrance";
import type { PaletteUniforms } from "@/scene/gpu/stage";
import type { TslNode } from "@/scene/gpu/tsl";
import { unitHash } from "@/scene/sphere";
import { HERO_GLINTS, heroPoint, starPoint } from "@/components/lab/sky/layout";
import { starLight } from "@/components/lab/sky/shaders";
import { approach } from "@/lib/timing";

/** The depth at which a star is drawn at its nominal size. */
const NOMINAL = 60;

export interface StarUniforms {
  readonly time: TslNode;
  readonly twinkle: TslNode;
  readonly hover: TslNode;
  readonly spikes: TslNode;
  readonly lines: TslNode;
}

export class NodeStars {
  readonly sprite: Sprite;
  readonly lines: LineSegments;
  /** Each node's star, world units, in node order. */
  readonly points: Vector3[];
  private readonly positions: InstancedBufferAttribute;
  private readonly graph: LabGraph;
  /** Line vertices that sit on the hovered star (every even one). */
  private lineFrom = -1;
  /** Whether the lines are wanted; they stay drawn while they fade out. */
  private linesWanted = false;

  constructor(colors: PaletteUniforms, u: StarUniforms, graph: LabGraph, entrance: Entrance) {
    this.graph = graph;
    const nodes = graph.nodes;
    const n = Math.max(1, nodes.length);
    const positions = new Float32Array(n * 3);
    const looks = new Float32Array(n * 4);
    // The few most recent glints are the heroes; the rest glint smaller.
    const rank = new Map(
      nodes
        .filter((node) => node.glint)
        .toSorted((a, b) => b.recency - a.recency)
        .map((node, i) => [node.id, i]),
    );
    this.points = nodes.map((node, i) => {
      const hero = heroPoint(rank.get(node.id) ?? HERO_GLINTS);
      const at = new Vector3(...(hero ?? starPoint(node)));
      positions.set([at.x, at.y, at.z], i * 3);
      looks.set(
        [
          size(node, hero !== undefined),
          hero !== undefined ? 0.6 + node.recency * 0.4 : node.glint ? 0.3 : 0,
          unitHash(`${node.id}:twinkle`) * Math.PI * 2,
          0.6 + node.recency * 0.4,
        ],
        i * 4,
      );
      return at;
    });
    this.positions = new InstancedBufferAttribute(positions, 3);
    const place = instancedBufferAttribute(this.positions);
    const look = instancedBufferAttribute(new InstancedBufferAttribute(looks, 4));
    const hovered = u.hover.equal(instanceIndex.toFloat());
    const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
    material.fog = false;
    material.positionNode = place;
    const depth = length(place).div(NOMINAL).pow(0.8);
    material.scaleNode = select(hovered, look.x.mul(1.8).add(1.5), look.x).mul(depth);
    const shimmer = sin(u.time.mul(0.8).add(look.z)).mul(0.2).mul(u.twinkle).add(1);
    const kindled = entrance.arrival(look.z.div(Math.PI * 2));
    material.colorNode = colors.ink;
    material.opacityNode = starLight(select(hovered, float(1), look.y), u.spikes)
      .mul(shimmer)
      .mul(look.w)
      .mul(kindled)
      .min(1);
    this.sprite = new Sprite(material);
    this.sprite.count = nodes.length;
    this.sprite.frustumCulled = false;

    const lineMaterial = new LineBasicNodeMaterial({ transparent: true, depthWrite: false });
    lineMaterial.fog = false;
    lineMaterial.colorNode = colors.ink;
    // Thin and faint, easing in on hover: a hint of the relationship, not a stroke.
    lineMaterial.opacityNode = u.lines.mul(0.2);
    this.lines = new LineSegments(new BufferGeometry(), lineMaterial);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
  }

  node(index: number): LabNode | undefined {
    return this.graph.nodes[index];
  }

  /**
   * Draw `index`'s edges as lines to its neighbours' stars. For -1 (no star)
   * the lines are let go: they keep their geometry and fade out (`fadeLines`)
   * rather than vanishing on the frame the pointer leaves.
   */
  constellation(index: number): void {
    if (index < 0) {
      this.linesWanted = false;
      return;
    }
    const points: number[] = [];
    const node = this.graph.nodes[index];
    const from = this.points[index];
    if (node !== undefined && from !== undefined) {
      const at = new Map(this.graph.nodes.map((n, i) => [n.id, i]));
      for (const edge of this.graph.edges) {
        const other =
          edge.source === node.id ? edge.target : edge.target === node.id ? edge.source : null;
        const to = other === null ? undefined : this.points[at.get(other) ?? -1];
        if (to !== undefined) points.push(from.x, from.y, from.z, to.x, to.y, to.z);
      }
    }
    this.lines.geometry.dispose();
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
    this.lines.geometry = geometry;
    this.lineFrom = points.length > 0 ? index : -1;
    // An empty batch is not drawn: a zero-vertex draw is not free.
    this.linesWanted = points.length > 0;
    this.lines.visible = this.linesWanted;
  }

  /**
   * One frame of the lines' opacity, from `opacity` toward shown or gone at
   * `rate` (1/s); hidden only once it has faded out. Returns the new opacity.
   */
  fadeLines(opacity: number, rate: number, dt: number, reduced: boolean): number {
    const target = this.linesWanted ? 1 : 0;
    const next = reduced ? target : approach(opacity, target, rate, dt);
    if (!this.linesWanted && next < 0.004) {
      this.lines.visible = false;
      return 0;
    }
    return next;
  }

  /** Stand star `index` at `to`, and its lines with it. */
  move(index: number, to: Vector3): void {
    const point = this.points[index];
    if (point === undefined) return;
    point.copy(to);
    this.positions.setXYZ(index, to.x, to.y, to.z);
    this.positions.needsUpdate = true;
    if (this.lineFrom !== index) return;
    const line = this.lines.geometry.getAttribute("position");
    for (let v = 0; v < line.count; v += 2) line.setXYZ(v, to.x, to.y, to.z);
    line.needsUpdate = true;
  }

  dispose(): void {
    this.lines.geometry.dispose();
  }
}

function size(node: LabNode, hero: boolean): number {
  if (hero) return 6 + node.recency * 3;
  return node.glint ? 2.6 : 0.9 + Math.min(1.2, Math.sqrt(node.degree) * 0.28);
}
