/**
 * The 3D graph, drawn on the scene kit's stage (`@/scene/gpu/stage`): the
 * same WebGPU + TSL renderer, post chain, palette uniforms, frame loop and
 * reveal the lab's studies stand on (Lab principles T1, P4), so nothing here
 * owns a renderer, a bloom or a tone mapping of its own. This module composes
 * the scene from its parts:
 *
 * - the drawn state and its layers (`force3d-layers`): nodes, links and
 *   direction particles, labels — one draw each;
 * - the camera (`force3d-camera`): follows the layout, flies to a selection;
 * - the pointer (`force3d-pick`): hover, select, open.
 *
 * Light (L2–L4): only glowing nodes and particles exceed 1, and bloom's
 * threshold is 1; range fog fades the far side of the graph into the ground,
 * following the camera's distance; a restrained starfield sits beyond it; the
 * backdrop is the page's own surface, lifted a little at the focal point;
 * dither breaks banding. No tone mapping: the tokens are reproduced exactly,
 * so the canvas meets the page without a seam (P1, P5). Frames are drawn only
 * while something moves (P3), which is the stage's loop rule.
 */
import type { PerspectiveCamera } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mountScene, type SceneStage } from "@/scene/gpu/stage";
import { starfield } from "@/scene/gpu/starfield";
import { toScreen, type ScreenPoint } from "@/scene/gpu/screen";
import type { SceneBackend } from "@/scene/backend";
import type { SceneHandle } from "@/scene/host";
import type { ScenePalette } from "@/scene/palette";
import type { GraphEmphasis } from "@/lib/graph-interaction";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import type { Timing } from "@/lib/timing";
import type { GraphCameraControls } from "./graph-camera-controls";
import { GraphCamera } from "./force3d-camera";
import { GraphLayers, type Force3dSettings } from "./force3d-layers";
import { GraphPick } from "./force3d-pick";

export type { Force3dSettings };

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
  /** `Appearance.dark`: whether the page is painted dark (bloom, stars). */
  readonly dark: boolean;
  readonly reducedMotion: boolean;
  readonly timing: Timing;
  readonly onSelect: (id: string | null) => void;
  readonly onOpen: (id: string) => void;
  readonly onHover: (hover: Force3dHover | null) => void;
}

/** What a render spec may read (test-render builds only hand it out). */
interface Force3dInspection {
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

/** The mounted 3D graph: the scene host's handle, and what only the graph is told. */
export interface Force3dScene extends SceneHandle {
  readonly controls: GraphCameraControls;
  setGraph(nodes: readonly LensNode[], edges: readonly LensEdge[]): void;
  setSettings(settings: Force3dSettings): void;
  setEmphasis(emphasis: GraphEmphasis): void;
  setPalette(palette: ScenePalette, link: string, dark: boolean): void;
  inspect(): Force3dInspection;
}

const FOV = 50;
const NEAR = 1;
const FAR = 40_000;
const STAR_RADIUS = 16_000;
/** Bloom: soft on the dark ground, lighter on the light one (a glow on white washes out). */
const BLOOM = { dark: 1.15, light: 0.4, radius: 0.7 } as const;
const STARS = { dark: 0.3, light: 0.1 } as const;

export async function mountForce3d(
  host: HTMLElement,
  init: Force3dSceneInit,
): Promise<Force3dScene> {
  const { parts, handle } = await mountScene(
    host,
    {
      fov: FOV,
      near: NEAR,
      far: FAR,
      palette: init.palette,
      timing: init.timing,
      reducedMotion: init.reducedMotion,
      bloom: { strength: init.dark ? BLOOM.dark : BLOOM.light, radius: BLOOM.radius },
      vignette: 0,
    },
    (stage) => graphScene(stage, init),
  );
  return { ...handle, ...parts.api };
}

/** The stage dressed for the graph: backdrop, fog, stars, the orbit. */
function dressStage(stage: SceneStage, dark: boolean) {
  stage.setToneMapping("none");
  stage.backdrop();
  const fog = stage.atmosphere(400, 2400);
  const stars = starfield(stage.colors, {
    seed: "graph-stars",
    count: 900,
    radius: STAR_RADIUS,
    size: 95,
    opacity: dark ? STARS.dark : STARS.light,
  });
  stage.scene.add(stars.sprite);
  stage.camera.position.set(0, 0, 900);
  const orbit = new OrbitControls(stage.camera, stage.renderer.domElement);
  orbit.enableDamping = !stage.reduced();
  orbit.dampingFactor = 0.09;
  orbit.rotateSpeed = 0.7;
  orbit.zoomSpeed = 0.9;
  /** Fog follows the camera's distance to what it looks at (L3); the stars travel with the eye. */
  const follow = (camera: PerspectiveCamera) => {
    const distance = camera.position.distanceTo(orbit.target);
    fog.near.value = distance * 0.55;
    fog.far.value = distance * 2.6;
    stars.sprite.position.copy(camera.position);
  };
  return { orbit, stars, follow };
}

function graphScene(stage: SceneStage, init: Force3dSceneInit) {
  const { camera } = stage;
  const canvas = stage.renderer.domElement;
  const { orbit, stars, follow } = dressStage(stage, init.dark);
  const layers = new GraphLayers(stage, init);
  const view = new GraphCamera(
    { camera, orbit },
    layers.places(),
    init.timing.follow,
    stage.invalidate,
  );
  const pick = new GraphPick({ canvas, camera }, layers.pickField(), {
    onSelect: init.onSelect,
    onOpen: init.onOpen,
    onHover: init.onHover,
    onHoverChange: (id) => {
      layers.hovered = id;
      layers.refresh();
    },
    wake: stage.invalidate,
  });
  const viewport = { width: 0, height: 0 };

  const frame = (dt: number) => {
    pick.frame();
    const flying = view.flying;
    const turning = view.step(dt, stage.reduced(), layers.laying, layers.settings.autorotate);
    if (flying) layers.touch();
    follow(camera);
    viewport.width = canvas.clientWidth;
    viewport.height = canvas.clientHeight;
    const drawing = layers.frame(dt, camera, viewport);
    return drawing || turning || pick.pending;
  };

  const api = {
    controls: view.controls(),
    setGraph: (nodes: readonly LensNode[], edges: readonly LensEdge[]) =>
      layers.setGraph(nodes, edges),
    setSettings: (next: Force3dSettings) => layers.setSettings(next),
    setEmphasis: (next: GraphEmphasis) => {
      const selected = next.selectedNodeId ?? null;
      const changed = selected !== (layers.emphasis.selectedNodeId ?? null);
      layers.emphasis = next;
      layers.refresh();
      if (changed && selected !== null) view.focus(selected);
    },
    setPalette: (next: ScenePalette, link: string, dark: boolean) => {
      stage.setPalette(next);
      stage.setBloom(dark ? BLOOM.dark : BLOOM.light);
      stars.opacity.value = dark ? STARS.dark : STARS.light;
      layers.setPalette(next, link);
    },
    inspect: (): Force3dInspection => inspection(stage, layers, view),
  };

  return {
    api,
    frame,
    setReducedMotion: (reduced: boolean) => {
      orbit.enableDamping = !reduced;
    },
    resize: (_width: number, height: number) => layers.resize(camera, height),
    dispose: () => {
      pick.dispose();
      orbit.dispose();
      // The stage's scene traversal frees every geometry and material left.
      layers.dispose();
    },
  };
}

function inspection(stage: SceneStage, layers: GraphLayers, view: GraphCamera): Force3dInspection {
  const { positions, topology } = layers;
  const canvas = stage.renderer.domElement;
  return {
    backend: stage.backend,
    nodes: topology.nodes.length,
    positions: topology.nodes.map(
      (_, i) =>
        [positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0] as const,
    ),
    frames: stage.frames(),
    bloom: stage.bloomStrength() > 0,
    particles: layers.particleCount(),
    flying: view.flying,
    screenOf: (id) => {
      const i = topology.index.get(id);
      if (i === undefined) return null;
      const world = {
        x: positions[i * 3] ?? 0,
        y: positions[i * 3 + 1] ?? 0,
        z: positions[i * 3 + 2] ?? 0,
      };
      const size = { width: canvas.clientWidth, height: canvas.clientHeight };
      const at: ScreenPoint = { x: 0, y: 0, depth: 0 };
      return toScreen(world, stage.camera, size, at) ? { x: at.x, y: at.y } : null;
    },
  };
}
