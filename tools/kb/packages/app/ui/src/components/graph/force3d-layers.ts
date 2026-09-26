/**
 * The 3D graph's drawn state: the topology, where its nodes are, the layout
 * that moves them, the eased emphasis, and the three layers drawn from them
 * — nodes (`force3d-nodes`), links and particles (`force3d-links`), labels
 * (`force3d-labels`). A new graph rebuilds the layers together and frees the
 * old ones through the scene kit's `disposeGraph`; the same shape with new
 * encodings only restyles them.
 */
import { Group, type PerspectiveCamera } from "three/webgpu";
import { disposeGraph } from "@/scene/gpu/dispose";
import type { SceneStage } from "@/scene/gpu/stage";
import type { ScenePalette } from "@/scene/palette";
import { EmphasisFade } from "@/lib/graph-fade";
import { graphFocus, type GraphEmphasis } from "@/lib/graph-interaction";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import { byLabelPriority } from "@/lib/graph-label-layout";
import { approachRate, type Timing } from "@/lib/timing";
import {
  particleLinks,
  setEmphasisTargets,
  topologyOf,
  type Force3dFades,
  type Force3dTopology,
} from "./force3d-emphasis";
import type { GraphPlaces } from "./force3d-camera";
import { LabelLayer } from "./force3d-labels";
import { startLayout3d, type Layout3d } from "./force3d-layout";
import { MAX_PARTICLE_LINKS, linkLayer, type LinkLayer } from "./force3d-links";
import { nodeLayer, type NodeLayer } from "./force3d-nodes";
import type { PickField } from "./force3d-pick";

export interface Force3dSettings {
  readonly spread: number;
  readonly linkDistance: number;
  readonly curvedLinks: boolean;
  readonly autorotate: boolean;
  readonly showLabels: boolean;
  readonly labelTopN: number;
}

/** Spiral seed placement for a node with no position yet. */
function seed(index: number, out: Float32Array): void {
  out[index * 3] = Math.cos(index * 2.4) * Math.sqrt(index + 1) * 12;
  out[index * 3 + 1] = Math.sin(index * 2.4) * Math.sqrt(index + 1) * 12;
  out[index * 3 + 2] = Math.sin(index) * 30;
}

function topologyKey(nodes: readonly LensNode[], edges: readonly LensEdge[]): string {
  return (
    nodes.map((n) => n.id).join("|") + "/" + edges.map((e) => `${e.source}>${e.target}`).join("|")
  );
}

/** The new positions: a node that stays keeps where it was, a new one is seeded. */
function carryPositions(
  was: Force3dTopology,
  old: Float32Array,
  next: Force3dTopology,
): Float32Array {
  const previous = new Map(was.nodes.map((n, i) => [n.id, i]));
  const positions = new Float32Array(next.nodes.length * 3);
  next.nodes.forEach((node, i) => {
    const at = previous.get(node.id);
    if (at !== undefined && at * 3 + 2 < old.length) {
      positions[i * 3] = old[at * 3] ?? 0;
      positions[i * 3 + 1] = old[at * 3 + 1] ?? 0;
      positions[i * 3 + 2] = old[at * 3 + 2] ?? 0;
    } else seed(i, positions);
  });
  return positions;
}

export interface GraphLayersInit {
  readonly nodes: readonly LensNode[];
  readonly edges: readonly LensEdge[];
  readonly settings: Force3dSettings;
  readonly emphasis: GraphEmphasis;
  readonly palette: ScenePalette;
  /** `--graph-edge`: a resting link's colour and alpha. */
  readonly link: string;
  readonly timing: Timing;
}

export class GraphLayers {
  topology: Force3dTopology;
  positions: Float32Array = new Float32Array(0);
  settings: Force3dSettings;
  emphasis: GraphEmphasis;
  hovered: string | null = null;
  /** The layout is still moving the nodes. */
  laying = false;
  /** Positions or emphasis changed since the layers were last written. */
  moved = true;
  readonly fades: Force3dFades;
  private readonly stage: SceneStage;
  private readonly group = new Group();
  private readonly layers = new Group();
  private readonly labels: LabelLayer;
  private readonly particleRate: number;
  private nodes: NodeLayer | null = null;
  private links: LinkLayer | null = null;
  private layout: Layout3d | null = null;
  private palette: ScenePalette;
  private link: string;
  private key = "";
  /** Node indices by label priority: who is labelled at rest. */
  private byPriority: number[] = [];

  constructor(stage: SceneStage, init: GraphLayersInit) {
    this.stage = stage;
    this.settings = init.settings;
    this.emphasis = init.emphasis;
    this.palette = init.palette;
    this.link = init.link;
    this.topology = topologyOf(init.nodes, init.edges);
    const quick = init.timing.quick;
    this.fades = {
      dim: new EmphasisFade(0, quick),
      glow: new EmphasisFade(0, quick),
      lift: new EmphasisFade(0, quick, 0),
      focus: new EmphasisFade(0, quick, 0),
    };
    this.particleRate = approachRate(init.timing.reveal);
    stage.scene.add(this.group);
    this.group.add(this.layers);
    this.labels = new LabelLayer(this.group, this.topology, this.palette);
    this.setGraph(init.nodes, init.edges);
  }

  /** World radius of node `i` now. */
  readonly radius = (i: number): number => this.nodes?.radius(i) ?? 4;

  /** Where the nodes are, as the camera frames them. */
  places(): GraphPlaces {
    return {
      positions: () => this.positions,
      count: () => this.topology.nodes.length,
      indexOf: (id) => this.topology.index.get(id) ?? -1,
      neighbours: (i) =>
        (this.topology.incident[i] ?? []).map((l) => {
          const a = this.topology.links[l * 2] ?? i;
          return a === i ? (this.topology.links[l * 2 + 1] ?? i) : a;
        }),
      radius: this.radius,
      labelOf: (id) => this.topology.nodes[this.topology.index.get(id) ?? -1]?.label,
    };
  }

  /** The nodes as picking sees them: a dimmed node cannot be picked. */
  pickField(): PickField {
    return {
      positions: () => this.positions,
      count: () => this.topology.nodes.length,
      radius: this.radius,
      present: (i) => (this.fades.dim.values[i] ?? 1) >= 0.5,
      idOf: (i) => this.topology.nodes[i]?.id,
    };
  }

  private startLayout(): void {
    this.layout?.dispose();
    this.laying = true;
    const { spread, linkDistance } = this.settings;
    this.layout = startLayout3d(
      {
        positions: this.positions,
        links: this.topology.links,
        params: { spread, linkDistance },
        live: !this.stage.reduced(),
      },
      (next, running) => {
        this.positions.set(next);
        this.laying = running;
        this.moved = true;
        this.stage.invalidate();
      },
    );
  }

  private rank(): void {
    this.byPriority = this.topology.nodes
      .map((node, i) => ({ i, id: node.id, degree: node.degree }))
      .toSorted(byLabelPriority)
      .map((n) => n.i);
  }

  private build(nodes: readonly LensNode[], edges: readonly LensEdge[]): void {
    const was = this.topology;
    this.topology = topologyOf(nodes, edges);
    this.positions = carryPositions(was, this.positions, this.topology);
    const count = this.topology.nodes.length;
    this.fades.dim.reset(count);
    this.fades.glow.reset(count, 0);
    this.fades.lift.reset(count, 0);
    this.fades.focus.reset(count, 0);
    // The old layers leave the scene with their GPU buffers.
    disposeGraph(this.layers);
    const colors = this.stage.colors;
    this.nodes = nodeLayer(this.topology, colors, this.fades);
    this.links = linkLayer(this.topology, colors, this.fades, this.settings.curvedLinks);
    this.links.setPalette(this.palette, this.link);
    this.layers.add(this.links.lines, this.nodes.mesh, this.links.particles);
    this.labels.reset(this.topology, this.palette);
    this.labels.resize(this.stage.camera, this.stage.renderer.domElement.clientHeight || 1);
    this.rank();
    this.startLayout();
    this.refresh();
  }

  setGraph(nodes: readonly LensNode[], edges: readonly LensEdge[]): void {
    const next = topologyKey(nodes, edges);
    if (next !== this.key) {
      this.key = next;
      this.build(nodes, edges);
      return;
    }
    // Same shape: only what is drawn changed (colour, size, label).
    this.topology = { ...this.topology, nodes };
    this.nodes?.restyle(nodes);
    this.labels.reset(this.topology, this.palette);
    this.rank();
    this.refresh();
  }

  setSettings(next: Force3dSettings): void {
    const previous = this.settings;
    this.settings = next;
    if (next.curvedLinks !== previous.curvedLinks) {
      this.build(this.topology.nodes, this.topology.edges);
      return;
    }
    if (next.spread !== previous.spread || next.linkDistance !== previous.linkDistance) {
      this.laying = true;
      this.layout?.reheat({ spread: next.spread, linkDistance: next.linkDistance });
    }
    this.refresh();
  }

  setPalette(palette: ScenePalette, link: string): void {
    this.palette = palette;
    this.link = link;
    this.links?.setPalette(palette, link);
    this.labels.reset(this.topology, palette);
    this.refresh();
  }

  /** Every node's emphasis targets, the particles and the labelled set, for the state now. */
  refresh(): void {
    const { topology, emphasis, hovered, fades, settings } = this;
    setEmphasisTargets(topology, emphasis, hovered, fades);
    if (this.stage.reduced()) {
      fades.dim.snap();
      fades.glow.snap();
      fades.lift.snap();
      fades.focus.snap();
    }
    const active = graphFocus(emphasis.selectedNodeId, hovered);
    this.links?.setParticleLinks(particleLinks(topology, active, MAX_PARTICLE_LINKS));
    const wanted = new Set<number>();
    if (settings.showLabels) {
      for (const i of this.byPriority.slice(0, settings.labelTopN)) wanted.add(i);
      for (const id of [active, ...(emphasis.highlightIds ?? [])]) {
        const i = id === null ? undefined : topology.index.get(id);
        if (i !== undefined) wanted.add(i);
      }
    }
    this.labels.want(wanted);
    this.moved = true;
    this.stage.invalidate();
  }

  resize(camera: PerspectiveCamera, height: number): void {
    this.labels.resize(camera, height);
    this.moved = true;
  }

  /** Ease the emphasis and write the layers for this frame; whether anything still moves. */
  frame(
    dt: number,
    camera: PerspectiveCamera,
    viewport: { width: number; height: number },
  ): boolean {
    const reduced = this.stage.reduced();
    const { fades } = this;
    const dimmed = fades.dim.step(dt, reduced);
    const glowed = fades.glow.step(dt, reduced);
    const lifted = fades.lift.step(dt, reduced);
    const focused = fades.focus.step(dt, reduced);
    const fading = dimmed || glowed || lifted || focused;
    if (this.moved || fading) {
      this.nodes?.update(this.positions);
      this.links?.update(this.positions);
      this.moved = false;
    }
    const particles =
      this.links?.stepParticles(dt, this.positions, reduced, this.particleRate) ?? false;
    this.labels.frame(this.positions, camera, viewport, fades, this.radius);
    return this.laying || fading || particles;
  }

  /** Mark the layers stale so the next frame rewrites them (the camera moved them on screen). */
  touch(): void {
    this.moved = true;
  }

  particleCount(): number {
    return this.links?.particles.visible === true ? this.links.particles.count : 0;
  }

  dispose(): void {
    this.layout?.dispose();
    this.layout = null;
    this.labels.dispose();
  }
}
