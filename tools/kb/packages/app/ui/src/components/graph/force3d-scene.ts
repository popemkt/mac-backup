/**
 * The 3D graph, drawn on the scene kit's stage (`@/scene/gpu/stage`): the
 * same WebGPU + TSL renderer, post chain, palette uniforms, frame loop and
 * reveal the lab's studies stand on (Lab principles T1, P4), so nothing here
 * owns a renderer, a bloom or a tone mapping of its own.
 *
 * - Nodes (`force3d-nodes`), links and direction particles
 *   (`force3d-links`), labels (`force3d-labels`): one draw each.
 * - Light (L2–L4): only glowing nodes and particles exceed 1, and bloom's
 *   threshold is 1; range fog fades the far side of the graph into the
 *   ground, following the camera's distance; a restrained starfield sits
 *   beyond it; the backdrop is the page's own surface, lifted a little at the
 *   focal point; dither breaks banding. No tone mapping: the tokens are
 *   reproduced exactly, so the canvas meets the page without a seam (P1, P5).
 * - Motion: the layout settles in view (`force3d-layout`, off the main
 *   thread), the camera follows it until the user takes it; select flies the
 *   camera to the node on a critically damped spring (`force3d-flight`);
 *   emphasis eases (`lib/graph-fade`). Under reduced motion the layout
 *   settles unseen, flights cut and nothing eases (M7).
 * - Frames are drawn only while something moves (P3): a settled, idle graph
 *   costs nothing, and a hidden tab draws nothing.
 */
import { Color, Group, Vector3 } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createStage } from "@/scene/gpu/stage";
import { starfield } from "@/scene/gpu/starfield";
import type { SceneBackend } from "@/scene/backend";
import type { ScenePalette } from "@/scene/palette";
import { EmphasisFade } from "@/lib/graph-fade";
import type { GraphEmphasis } from "@/lib/graph-interaction";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import { approachRate, type Timing } from "@/lib/timing";
import type { GraphCameraControls } from "./graph-camera-controls";
import {
  focusOf,
  particleLinks,
  setEmphasisTargets,
  topologyOf,
  type Force3dFades,
  type Force3dTopology,
} from "./force3d-emphasis";
import { CameraFlight, dollyGoal, fitGoal, neighbourhoodGoal, type Vec3 } from "./force3d-flight";
import { LabelLayer } from "./force3d-labels";
import { startLayout3d, type Layout3d } from "./force3d-layout";
import { MAX_PARTICLE_LINKS, linkLayer, type LinkLayer } from "./force3d-links";
import { nodeLayer, type NodeLayer } from "./force3d-nodes";

export interface Force3dSettings {
  readonly spread: number;
  readonly linkDistance: number;
  readonly curvedLinks: boolean;
  readonly autorotate: boolean;
  readonly showLabels: boolean;
  readonly labelTopN: number;
}

export interface Force3dHover {
  readonly id: string;
  /** Host-relative CSS pixels. */
  readonly x: number;
  readonly y: number;
}

export interface Force3dSceneInit {
  readonly nodes: readonly LensNode[];
  readonly edges: readonly LensEdge[];
  readonly settings: Force3dSettings;
  readonly emphasis: GraphEmphasis;
  readonly palette: ScenePalette;
  /** `--graph-edge`: a resting link's colour and alpha. */
  readonly link: string;
  readonly reducedMotion: boolean;
  readonly timing: Timing;
  readonly onSelect: (id: string | null) => void;
  readonly onOpen: (id: string) => void;
  readonly onHover: (hover: Force3dHover | null) => void;
}

/** What a render spec may read (test-render builds only hand it out). */
export interface Force3dInspection {
  readonly backend: SceneBackend;
  readonly nodes: number;
  /** x, y, z per node, as laid out now. */
  readonly positions: readonly (readonly [number, number, number])[];
  readonly frames: number;
  readonly bloom: boolean;
  readonly particles: number;
  readonly flying: boolean;
  /** Screen position of a node, host-relative CSS pixels. */
  readonly screenOf: (id: string) => { x: number; y: number } | null;
}

export interface Force3dScene {
  readonly backend: SceneBackend;
  readonly controls: GraphCameraControls;
  setGraph(nodes: readonly LensNode[], edges: readonly LensEdge[]): void;
  setSettings(settings: Force3dSettings): void;
  setEmphasis(emphasis: GraphEmphasis): void;
  setPalette(palette: ScenePalette, link: string): void;
  setReducedMotion(reduced: boolean): void;
  resize(width: number, height: number): void;
  /** Off while the tab is hidden: nothing is drawn. */
  setRunning(running: boolean): void;
  inspect(): Force3dInspection;
  dispose(): void;
}

const FOV = 50;
const NEAR = 1;
const FAR = 40_000;
const STAR_RADIUS = 16_000;
/** Bloom: soft on the dark ground, lighter on the light one (a glow on white washes out). */
const BLOOM = { dark: 1.15, light: 0.4, radius: 0.7 } as const;
const STARS = { dark: 0.3, light: 0.1 } as const;
/** The fit leaves this much of the frame around the graph. */
const FIT_PADDING = 0.8;
/** A fly-to frames the node's 1-hop neighbourhood with this much margin, never nearer. */
const FOCUS_PADDING = 1.25;
const FOCUS_NEAREST = 160;
/** Pointer travel under which a press is a click, not an orbit (CSS px). */
const CLICK_SLOP = 4;
const DOUBLE_CLICK_MS = 320;

/** A frame with nothing to do. */
const idle = () => false;

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

export async function mountForce3d(
  host: HTMLElement,
  init: Force3dSceneInit,
): Promise<Force3dScene> {
  let reduced = init.reducedMotion;
  let visible = true;
  let busy = true;
  let frames = 0;
  // Filled in below; the stage's frame loop calls `frame` once everything exists.
  let frame: (dt: number) => boolean = idle;
  const stage = await createStage(host, {
    fov: FOV,
    near: NEAR,
    far: FAR,
    palette: init.palette,
    timing: init.timing,
    bloom: { strength: darkGround(init.palette) ? BLOOM.dark : BLOOM.light, radius: BLOOM.radius },
    vignette: 0,
    frame: (dt) => {
      frames++;
      busy = frame(dt);
      stage.setRunning(visible && busy);
    },
  });
  stage.setToneMapping("none");
  stage.backdrop();
  const fog = stage.atmosphere(400, 2400);
  const stars = starfield(stage.colors, {
    seed: "graph-stars",
    count: 900,
    radius: STAR_RADIUS,
    size: 95,
    opacity: darkGround(init.palette) ? STARS.dark : STARS.light,
  });
  stage.scene.add(stars.sprite);
  const camera = stage.camera;
  camera.position.set(0, 0, 900);
  const canvas = stage.renderer.domElement;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduced;
  controls.dampingFactor = 0.09;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.9;

  const wake = () => {
    if (!visible) return;
    busy = true;
    stage.setRunning(true);
  };

  // --- graph state -------------------------------------------------------
  let settings = init.settings;
  let emphasis = init.emphasis;
  let palette = init.palette;
  let hovered: string | null = null;
  let topology: Force3dTopology = topologyOf(init.nodes, init.edges);
  /** Node indices, largest first: who is labelled at rest. */
  let bySize: number[] = [];
  const rankBySize = () => {
    bySize = topology.nodes
      .map((node, i) => ({ i, size: node.size, id: node.id }))
      .toSorted((a, b) => b.size - a.size || a.id.localeCompare(b.id))
      .map((n) => n.i);
  };
  let key = "";
  let positions = new Float32Array(0);
  let layout: Layout3d | null = null;
  let laying = false;
  let moved = true;
  const fades: Force3dFades = {
    dim: new EmphasisFade(0, init.timing.quick),
    glow: new EmphasisFade(0, init.timing.quick),
    focus: new EmphasisFade(0, init.timing.quick, 0),
  };
  const graph = new Group();
  stage.scene.add(graph);
  let nodes: NodeLayer | null = null;
  let links: LinkLayer | null = null;
  const labels = new LabelLayer(graph, topology, palette);
  const particleRate = approachRate(init.timing.reveal);

  // --- camera ------------------------------------------------------------
  const flight = new CameraFlight(init.timing.follow);
  const goal = { eye: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 } };
  const view = { fov: FOV, aspect: 1, eye: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 } };
  /** The user has moved the camera: the fit stops following the layout. */
  let taken = false;
  let flyTo: string | null = null;
  const readView = () => {
    view.aspect = camera.aspect;
    copyInto(view.eye, camera.position);
    copyInto(view.look, controls.target);
  };
  const fly = () => {
    readView();
    flight.start(view.eye, view.look, goal.eye, goal.look);
    wake();
  };
  const fit = () => {
    readView();
    fitGoal(positions, topology.nodes.length, view, FIT_PADDING, goal);
    fly();
  };
  const nodeAt = (id: string, out: Vec3): number => {
    const i = topology.index.get(id);
    if (i === undefined) return -1;
    out.x = positions[i * 3] ?? 0;
    out.y = positions[i * 3 + 1] ?? 0;
    out.z = positions[i * 3 + 2] ?? 0;
    return i;
  };
  const focusPoint = { x: 0, y: 0, z: 0 };
  const aimAt = (id: string) => {
    const i = nodeAt(id, focusPoint);
    if (i < 0) return false;
    readView();
    const neighbours: number[] = [];
    for (const l of topology.incident[i] ?? []) {
      const a = topology.links[l * 2] ?? i;
      neighbours.push(a === i ? (topology.links[l * 2 + 1] ?? i) : a);
    }
    neighbourhoodGoal(
      positions,
      { node: i, neighbours },
      view,
      { radius: (nodes?.radius(i) ?? 4) * 2, padding: FOCUS_PADDING, nearest: FOCUS_NEAREST },
      goal,
    );
    return true;
  };
  const focusNode = (id: string) => {
    taken = true;
    flyTo = id;
    if (aimAt(id)) fly();
  };
  const dolly = (scale: number) => {
    taken = true;
    flyTo = null;
    readView();
    dollyGoal(view, scale, goal);
    fly();
  };
  controls.addEventListener("start", () => {
    taken = true;
    flyTo = null;
    flight.cancel();
    wake();
  });
  controls.addEventListener("change", wake);

  // --- emphasis ------------------------------------------------------------
  const refreshEmphasis = () => {
    setEmphasisTargets(topology, emphasis, hovered, fades);
    if (reduced) {
      fades.dim.snap();
      fades.glow.snap();
      fades.focus.snap();
    }
    links?.setParticleLinks(
      particleLinks(topology, focusOf(emphasis, hovered), MAX_PARTICLE_LINKS),
    );
    const wanted = new Set<number>();
    if (settings.showLabels) {
      for (const i of bySize.slice(0, settings.labelTopN)) wanted.add(i);
      const active = focusOf(emphasis, hovered);
      for (const id of [active, ...(emphasis.highlightIds ?? [])]) {
        const i = id === null ? undefined : topology.index.get(id);
        if (i !== undefined) wanted.add(i);
      }
    }
    labels.want(wanted);
    moved = true;
    wake();
  };

  // --- graph ---------------------------------------------------------------
  const startLayout = () => {
    layout?.dispose();
    laying = true;
    layout = startLayout3d(
      {
        positions,
        links: topology.links,
        params: { spread: settings.spread, linkDistance: settings.linkDistance },
        live: !reduced,
      },
      (next, running) => {
        positions.set(next);
        laying = running;
        moved = true;
        wake();
      },
    );
  };
  const build = (nextNodes: readonly LensNode[], nextEdges: readonly LensEdge[]) => {
    const previous = new Map(topology.nodes.map((n, i) => [n.id, i]));
    const old = positions;
    topology = topologyOf(nextNodes, nextEdges);
    positions = new Float32Array(topology.nodes.length * 3);
    topology.nodes.forEach((node, i) => {
      const was = previous.get(node.id);
      if (was !== undefined && was * 3 + 2 < old.length) {
        positions[i * 3] = old[was * 3] ?? 0;
        positions[i * 3 + 1] = old[was * 3 + 1] ?? 0;
        positions[i * 3 + 2] = old[was * 3 + 2] ?? 0;
      } else seed(i, positions);
    });
    fades.dim.reset(topology.nodes.length);
    fades.glow.reset(topology.nodes.length, 0);
    fades.focus.reset(topology.nodes.length, 0);
    if (nodes !== null) graph.remove(nodes.mesh);
    if (links !== null) graph.remove(links.lines, links.particles);
    disposeLayer(nodes, links);
    nodes = nodeLayer(topology, stage.colors, fades);
    links = linkLayer(topology, stage.colors, fades, settings.curvedLinks);
    links.setPalette(palette, link);
    graph.add(links.lines, nodes.mesh, links.particles);
    labels.reset(topology, palette);
    labels.resize(camera, canvas.clientHeight || 1);
    rankBySize();
    startLayout();
    refreshEmphasis();
  };
  let link = init.link;

  // --- pointer -----------------------------------------------------------
  const pointer = { x: 0, y: 0, inside: false, dirty: false };
  let press: { x: number; y: number } | null = null;
  let lastClick = { id: "", at: 0 };
  const projected = new Vector3();
  const pick = (x: number, y: number): number => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const focal = height / 2 / Math.tan((FOV * Math.PI) / 360);
    let best = -1;
    let bestDepth = Infinity;
    for (let i = 0; i < topology.nodes.length; i++) {
      if ((fades.dim.values[i] ?? 1) < 0.5) continue;
      projected.set(positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0);
      const depth = projected.distanceTo(camera.position);
      projected.project(camera);
      if (projected.z > 1) continue;
      const sx = ((projected.x + 1) / 2) * width;
      const sy = ((1 - projected.y) / 2) * height;
      const reach = Math.max(6, ((nodes?.radius(i) ?? 4) * focal) / Math.max(1, depth)) + 2;
      if (Math.hypot(sx - x, sy - y) <= reach && depth < bestDepth) {
        best = i;
        bestDepth = depth;
      }
    }
    return best;
  };
  const local = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const onMove = (event: PointerEvent) => {
    const at = local(event);
    pointer.x = at.x;
    pointer.y = at.y;
    pointer.inside = true;
    pointer.dirty = true;
    wake();
  };
  const onLeave = () => {
    pointer.inside = false;
    pointer.dirty = true;
    wake();
  };
  const onDown = (event: PointerEvent) => {
    press = local(event);
  };
  const onUp = (event: PointerEvent) => {
    const at = local(event);
    const was = press;
    press = null;
    if (was === null || Math.hypot(at.x - was.x, at.y - was.y) > CLICK_SLOP) return;
    const i = pick(at.x, at.y);
    const node = topology.nodes[i];
    const now = performance.now();
    if (node !== undefined && lastClick.id === node.id && now - lastClick.at < DOUBLE_CLICK_MS) {
      init.onOpen(node.id);
      return;
    }
    lastClick = { id: node?.id ?? "", at: now };
    init.onSelect(node?.id ?? null);
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);

  const hoverTest = () => {
    if (!pointer.dirty) return;
    pointer.dirty = false;
    const i = pointer.inside && press === null ? pick(pointer.x, pointer.y) : -1;
    const id = topology.nodes[i]?.id ?? null;
    canvas.style.cursor = id === null ? "" : "pointer";
    if (id !== null) init.onHover({ id, x: pointer.x, y: pointer.y });
    if (id === hovered) return;
    hovered = id;
    if (id === null) init.onHover(null);
    refreshEmphasis();
  };

  // --- the frame -----------------------------------------------------------
  const nodeRadius = (i: number) => nodes?.radius(i) ?? 0;
  const viewport = { width: 0, height: 0 };
  /** Step every eased emphasis; whether any moved. */
  const stepFades = (dt: number) => {
    const dimmed = fades.dim.step(dt, reduced);
    const glowed = fades.glow.step(dt, reduced);
    const focused = fades.focus.step(dt, reduced);
    return dimmed || glowed || focused;
  };
  /** Fly or orbit the camera; whether it moved. */
  const stepCamera = (dt: number) => {
    if (laying && !taken) {
      readView();
      fitGoal(positions, topology.nodes.length, view, FIT_PADDING, goal);
      flight.start(view.eye, view.look, goal.eye, goal.look);
    } else if (flyTo !== null && laying) {
      if (aimAt(flyTo)) flight.retarget(goal.eye, goal.look);
    }
    const wasFlying = flight.active;
    const flying = flight.step(dt, reduced);
    if (wasFlying) {
      camera.position.set(flight.eye.x, flight.eye.y, flight.eye.z);
      controls.target.set(flight.look.x, flight.look.y, flight.look.z);
      camera.lookAt(controls.target);
    }
    // A flight owns the camera; otherwise the orbit does (its damping and
    // the ambient turn, which reduced motion stops).
    controls.autoRotate = settings.autorotate && !reduced;
    const orbiting = !flying && controls.update(dt);
    return flying || orbiting;
  };
  frame = (dt) => {
    hoverTest();
    const fading = stepFades(dt);
    const flying = flight.active;
    const turning = stepCamera(dt);
    if (moved || fading || flying) {
      nodes?.update(positions);
      links?.update(positions);
      moved = false;
    }
    const particles = links?.stepParticles(dt, positions, reduced, particleRate) ?? false;
    // Fog follows the camera's distance to what it looks at (L3).
    const distance = camera.position.distanceTo(controls.target);
    fog.near.value = distance * 0.55;
    fog.far.value = distance * 2.6;
    // The stars stand at infinity: they travel with the eye.
    stars.sprite.position.copy(camera.position);
    viewport.width = canvas.clientWidth;
    viewport.height = canvas.clientHeight;
    labels.frame(positions, camera, viewport, fades, nodeRadius);
    return laying || fading || turning || particles || pointer.dirty;
  };

  build(init.nodes, init.edges);
  key = topologyKey(init.nodes, init.edges);
  await stage.reveal();

  const cameraControls: GraphCameraControls = {
    fit: () => {
      taken = true;
      flyTo = null;
      fit();
    },
    reset: () => {
      taken = false;
      flyTo = null;
      fit();
    },
    zoomIn: () => dolly(0.7),
    zoomOut: () => dolly(1.4),
    focusNode,
    labelOf: (id) => topology.nodes[topology.index.get(id) ?? -1]?.label,
  };

  return {
    backend: stage.backend,
    controls: cameraControls,
    setGraph: (nextNodes, nextEdges) => {
      const next = topologyKey(nextNodes, nextEdges);
      if (next === key) {
        // Same shape: only what is drawn changed (colour, size, label).
        topology = { ...topology, nodes: nextNodes };
        nodes?.restyle(nextNodes);
        labels.reset(topology, palette);
        rankBySize();
        refreshEmphasis();
        return;
      }
      key = next;
      build(nextNodes, nextEdges);
    },
    setSettings: (next) => {
      const previous = settings;
      settings = next;
      if (next.curvedLinks !== previous.curvedLinks) build(topology.nodes, topology.edges);
      else if (next.spread !== previous.spread || next.linkDistance !== previous.linkDistance) {
        laying = true;
        layout?.reheat({ spread: next.spread, linkDistance: next.linkDistance });
      }
      refreshEmphasis();
    },
    setEmphasis: (next) => {
      const selected = next.selectedNodeId ?? null;
      const changed = selected !== (emphasis.selectedNodeId ?? null);
      emphasis = next;
      refreshEmphasis();
      if (changed && selected !== null) focusNode(selected);
    },
    setPalette: (next, nextLink) => {
      const dark = darkGround(next);
      palette = next;
      link = nextLink;
      stage.setPalette(next);
      stage.setBloom(dark ? BLOOM.dark : BLOOM.light);
      stars.opacity.value = dark ? STARS.dark : STARS.light;
      links?.setPalette(next, nextLink);
      labels.reset(topology, palette);
      refreshEmphasis();
    },
    setReducedMotion: (next) => {
      reduced = next;
      controls.enableDamping = !next;
      wake();
    },
    resize: (width, height) => {
      stage.resize(width, height);
      labels.resize(camera, height);
      moved = true;
      wake();
    },
    setRunning: (next) => {
      visible = next;
      stage.setRunning(visible && busy);
      if (visible) stage.invalidate();
    },
    inspect: () => ({
      backend: stage.backend,
      nodes: topology.nodes.length,
      positions: topology.nodes.map(
        (_, i) =>
          [positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0] as const,
      ),
      frames,
      bloom: stage.bloomStrength() > 0,
      particles: links?.particles.visible === true ? links.particles.count : 0,
      flying: flight.active,
      screenOf: (id) => {
        if (nodeAt(id, focusPoint) < 0) return null;
        projected.set(focusPoint.x, focusPoint.y, focusPoint.z).project(camera);
        return {
          x: ((projected.x + 1) / 2) * canvas.clientWidth,
          y: ((1 - projected.y) / 2) * canvas.clientHeight,
        };
      },
    }),
    dispose: () => {
      layout?.dispose();
      layout = null;
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      controls.dispose();
      labels.dispose();
      // The stage's scene traversal frees every geometry and material left.
      stage.dispose();
    },
  };
}

/**
 * Whether the palette's ground is dark: what decides how strong the bloom,
 * how visible the stars and how faint a resting link is. Read from the
 * colour itself, so every design system's variants answer for themselves.
 */
const probe = new Color();
function darkGround(palette: ScenePalette): boolean {
  probe.set(palette.ground);
  return 0.2126 * probe.r + 0.7152 * probe.g + 0.0722 * probe.b < 0.18;
}

function copyInto(out: Vec3, from: { x: number; y: number; z: number }): void {
  out.x = from.x;
  out.y = from.y;
  out.z = from.z;
}

/** A layer's GPU buffers, once it has left the scene. */
function disposeLayer(nodes: NodeLayer | null, links: LinkLayer | null): void {
  if (nodes !== null) {
    nodes.mesh.geometry.dispose();
    for (const m of [nodes.mesh.material].flat()) m.dispose();
    nodes.mesh.dispose();
  }
  if (links !== null) {
    links.lines.geometry.dispose();
    for (const m of [links.lines.material, links.particles.material].flat()) m.dispose();
  }
}
