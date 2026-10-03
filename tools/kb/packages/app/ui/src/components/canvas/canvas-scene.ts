/**
 * The 3D canvas: the canvas document drawn in depth on the scene kit's stage
 * (`@/scene/gpu/stage`), through the one camera model (DESIGN-UI.md → Canvas
 * → Projections). It and its layers (`canvas-scene-items` with its mesh
 * builders `canvas-scene-solids`, and `canvas-scene-edges`) are the only part
 * of the canvas that touches three, and load only inside `canvas-3d-stage`'s
 * lazy chunk.
 *
 * - **Items** and **edges** are their layers'.
 * - **The canvas plane** is the floor, and carries the 2D dot grid, fading
 *   out with distance.
 * - **The camera** is the rig's view (`lib/canvas-camera-rig`), stepped and
 *   applied every frame, through either lens; canvas space (y down the top
 *   view) maps to three's (y up it) by flipping y, for points and camera
 *   alike, and z is up in both.
 *
 * Untoned and unbloomed: a card's face is its tokens' colours, unlit, and
 * a solid's body is the rig's matcap finish, shaded without lights.
 */
import {
  Color,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector2,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
} from "three/webgpu";
import { float, fract, fwidth, length, positionWorld, smoothstep, uniform } from "three/tsl";
import { mountScene, type SceneStage } from "@/scene/gpu/stage";
import { toScreen, type ScreenPoint } from "@/scene/gpu/screen";
import type { SceneBackend } from "@/scene/backend";
import type { SceneHandle } from "@/scene/host";
import type { ScenePalette } from "@/scene/palette";
import { PERSPECTIVE_FOV, cameraPose, type CanvasView, type ViewSize } from "@/lib/canvas-camera";
import type { CanvasCameraRig } from "@/lib/canvas-camera-rig";
import type { Timing } from "@/lib/timing";
import { over, type CardLook } from "./canvas-card-face";
import { ItemLayer } from "./canvas-scene-items";
import type { CanvasSceneContent } from "./canvas-scene-content";
import { EdgeLayer } from "./canvas-scene-edges";

export interface CanvasSceneInit {
  readonly rig: CanvasCameraRig;
  readonly content: CanvasSceneContent;
  readonly look: CardLook;
  readonly palette: ScenePalette;
  readonly dark: boolean;
  readonly timing: Timing;
  readonly reducedMotion: boolean;
}

/** What a render spec and the projection contract read back from a mounted scene. */
interface CanvasSceneInspection {
  readonly backend: SceneBackend;
  readonly frames: number;
  /** Item ids drawn, back to front. */
  readonly items: readonly string[];
  /** Edge ids drawn. */
  readonly edges: readonly string[];
  /** Item and edge ids drawn as selected. */
  readonly selected: readonly string[];
  /** Where an item's centre is on the canvas, CSS pixels; null when out of view. */
  screenOf(id: string): { x: number; y: number } | null;
  /**
   * An item as drawn: the canvas-space height of its plane, and its
   * footprint's box corners on the canvas (CSS pixels), from the mesh itself.
   */
  drawnOf(id: string): { z: number; corners: { x: number; y: number }[] } | null;
  /**
   * The mesh item `id` is drawn as, placed in three's world (canvas y
   * flipped): what a probe asks the depth buffer's question of — which drawn
   * surface a ray meets first.
   */
  bodyOf(id: string): Object3D | null;
}

export interface CanvasScene extends SceneHandle {
  setContent(content: CanvasSceneContent): void;
  setLook(look: CardLook, palette: ScenePalette, dark: boolean): void;
  inspect(): CanvasSceneInspection;
}

/**
 * The narrowest field of view drawn in perspective, degrees. Below it the
 * camera is drawn orthographic, exactly: the end of a dolly zoom and the
 * orthographic lens are the same picture as the 2D canvas.
 */
const MIN_FOV = 0.5;
/** Where an orthographic eye stands back from the focus, canvas units: in front of any canvas. */
const ORTHO_EYE = 50_000;
/** The canvas plane sits just below the cards that lie on it. */
const PLANE_Z = -1;
/** The 2D dot grid's pitch and dot radius, canvas units. */
const GRID_STEP = 20;
const GRID_DOT = 1.1;

const flip = (p: { x: number; y: number; z: number }, out: Vector3) => out.set(p.x, -p.y, p.z);

/**
 * Aim three's camera at `view`, for a canvas of `size`; how far the eye
 * stands from the focus. An orthographic view keeps the perspective camera
 * and gives it an orthographic projection, so the stage's one camera serves
 * both lenses.
 */
function applyView(camera: PerspectiveCamera, view: CanvasView, size: ViewSize, eye: Vector3) {
  const ortho = view.fov < MIN_FOV;
  const pose = cameraPose(view, size);
  camera.aspect = size.width / Math.max(1, size.height);
  flip(pose.target, eye);
  flip(pose.eye, camera.position);
  if (ortho) camera.position.sub(eye).setLength(ORTHO_EYE).add(eye);
  flip(pose.up, camera.up);
  camera.lookAt(eye);
  const distance = camera.position.distanceTo(eye);
  if (ortho) {
    camera.near = 1;
    camera.far = ORTHO_EYE * 3;
    const w = size.width / 2 / view.zoom;
    const h = size.height / 2 / view.zoom;
    camera.projectionMatrix.makeOrthographic(
      -w,
      w,
      h,
      -h,
      camera.near,
      camera.far,
      camera.coordinateSystem,
      camera.reversedDepth,
    );
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  } else {
    camera.fov = view.fov;
    camera.near = Math.max(1, distance * 0.02);
    camera.far = distance * 8 + 40_000;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
  return distance;
}

/** The 2D dot grid on the canvas plane, fading out around the focus. */
function canvasPlane() {
  const focus = uniform(new Vector2());
  const reach = uniform(1200);
  const ink = uniform(new Color());
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const at = positionWorld.xy;
  const cell = length(fract(at.div(GRID_STEP)).sub(0.5)).mul(GRID_STEP);
  const aa = fwidth(cell).max(0.02);
  const dot = float(1).sub(smoothstep(float(GRID_DOT).sub(aa), float(GRID_DOT).add(aa), cell));
  // Where a dot shrinks below a pixel the grid would turn to haze; it fades out instead.
  const legible = float(1).sub(smoothstep(0.5, 1.4, aa.div(GRID_DOT)));
  const fade = float(1).sub(smoothstep(reach.mul(0.35), reach, length(at.sub(focus))));
  material.colorNode = ink;
  material.opacityNode = dot.mul(legible).mul(fade);
  const geometry = new PlaneGeometry(200_000, 200_000);
  const mesh = new Mesh(geometry, material);
  mesh.position.z = PLANE_Z;
  mesh.renderOrder = -2;
  return {
    mesh,
    /** The dots' colour: the 2D grid's, already composited over the ground. */
    setLook: (look: CardLook) => {
      ink.value.set(over(look, look.ink, 0.09));
    },
    follow: (view: CanvasView, size: ViewSize) => {
      focus.value.set(view.x, -view.y);
      reach.value = (Math.max(size.width, size.height) / view.zoom) * 1.1;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

export async function mountCanvasScene(
  host: HTMLElement,
  init: CanvasSceneInit,
): Promise<CanvasScene> {
  const { parts, handle } = await mountScene(
    host,
    {
      fov: PERSPECTIVE_FOV,
      palette: init.palette,
      timing: init.timing,
      reducedMotion: init.reducedMotion,
      bloom: { strength: 0, radius: 0.4 },
      vignette: 0.18,
    },
    (stage) => canvasScene(stage, init),
  );
  return { ...handle, ...parts.api };
}

function canvasScene(stage: SceneStage, init: CanvasSceneInit) {
  const { camera, scene } = stage;
  const canvas = stage.renderer.domElement;
  // An orthographic projection is built for the renderer's clip space before its first frame.
  camera.coordinateSystem = stage.renderer.coordinateSystem;
  stage.setToneMapping("none");
  stage.backdrop({});
  const fog = stage.atmosphere(4000, 16_000);
  const cards = new ItemLayer(init.look, init.dark, stage.invalidate);
  const edges = new EdgeLayer(init.look);
  const plane = canvasPlane();
  plane.setLook(init.look);
  scene.add(plane.mesh, edges.root, cards.root);
  let content = init.content;
  cards.sync(content);
  edges.sync(content);
  const { rig } = init;
  rig.wake = stage.invalidate;
  // The stage steps every frame by 0 under reduced motion; a flight must land instead.
  rig.setReducedMotion(init.reducedMotion);
  const viewport = { width: 1, height: 1 };
  const eye = new Vector3();

  const frame = (dt: number) => {
    const moving = rig.step(dt);
    viewport.width = canvas.clientWidth || viewport.width;
    viewport.height = canvas.clientHeight || viewport.height;
    const distance = applyView(camera, rig.view, viewport, eye);
    fog.near.value = distance * 1.25;
    fog.far.value = distance * 4.5;
    plane.follow(rig.view, viewport);
    return moving;
  };

  const onScreen = (world: { x: number; y: number; z: number }) => {
    const at: ScreenPoint = { x: 0, y: 0, depth: 0 };
    return toScreen(world, camera, viewport, at) ? { x: at.x, y: at.y } : null;
  };

  const api = {
    setContent: (next: CanvasSceneContent) => {
      content = next;
      cards.sync(content);
      edges.sync(content);
      stage.invalidate();
    },
    setLook: (look: CardLook, palette: ScenePalette, dark: boolean) => {
      stage.setPalette(palette);
      plane.setLook(look);
      cards.setLook(look, dark);
      edges.setLook(look);
      cards.sync(content);
      edges.sync(content);
      stage.invalidate();
    },
    inspect: (): CanvasSceneInspection => ({
      backend: stage.backend,
      frames: stage.frames(),
      items: cards.order,
      edges: edges.ids,
      selected: [
        ...cards.order.filter((id) => content.selection.nodeIds.has(id)),
        ...edges.ids.filter((id) => content.selection.edgeIds.has(id)),
      ],
      screenOf: (id) => {
        const drawn = cards.drawn(id);
        if (drawn === null) return null;
        const [a, , c] = drawn.corners;
        if (a === undefined || c === undefined) return null;
        return onScreen({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 });
      },
      drawnOf: (id) => {
        const drawn = cards.drawn(id);
        if (drawn === null) return null;
        const corners = drawn.corners.map(onScreen);
        if (corners.some((corner) => corner === null)) return null;
        return { z: drawn.z, corners: corners.filter((corner) => corner !== null) };
      },
      bodyOf: (id) => cards.bodyOf(id),
    }),
  };

  return {
    api,
    frame,
    resize: (width: number, height: number) => {
      viewport.width = width;
      viewport.height = height;
      // The stage drew for its new size already; the camera's aim depends on it too.
      stage.invalidate();
    },
    setReducedMotion: (reduced: boolean) => rig.setReducedMotion(reduced),
    dispose: () => {
      rig.wake = () => {};
      edges.dispose();
      cards.dispose();
      plane.dispose();
    },
  };
}
