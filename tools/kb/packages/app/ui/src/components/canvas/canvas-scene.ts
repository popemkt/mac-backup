/**
 * The 3D canvas: the canvas document drawn in depth on the scene kit's stage
 * (`@/scene/gpu/stage`), through the one camera model (DESIGN-UI.md → Canvas
 * → Projections). It and its layers (`canvas-scene-items` with its mesh
 * builders `canvas-scene-solids`, and `canvas-scene-edges`) are the only part
 * of the canvas that touches three, and load only inside `canvas-3d-stage`'s
 * lazy chunk.
 *
 * - **Items** and **edges** are their layers'; the **gizmo** on the
 *   selection is `canvas-scene-gizmo`'s.
 * - **The canvas plane** is the floor, and carries the 2D dot grid, fading
 *   out with distance.
 * - **The camera** is the rig's view (`components/canvas/canvas-camera-rig`), stepped and
 *   applied every frame, through either lens; canvas space (y down the top
 *   view) maps to three's (y up it) by flipping y, for points and camera
 *   alike, and z is up in both (`canvas-scene-space`).
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
import type { CanvasAxes } from "@kb/canvas";
import type { SceneHandle } from "@/scene/host";
import type { ScenePalette } from "@/scene/palette";
import {
  PERSPECTIVE_FOV,
  cameraPose,
  viewAxes,
  type CanvasPoint,
  type CanvasView,
  type ViewSize,
} from "./canvas-camera";
import type { GizmoChoice, SceneGizmo } from "./canvas-gizmo";
import { GizmoLayer } from "./canvas-scene-gizmo";
import { toThree } from "./canvas-scene-space";
import type { CanvasCameraRig } from "./canvas-camera-rig";
import type { Timing } from "@kb/ui-sdk";
import { over, type CardLook } from "./canvas-card-face";
import { ItemLayer } from "./canvas-scene-items";
import { LabelLayer } from "./canvas-scene-labels";
import type { CanvasSceneContent } from "./canvas-scene-content";
import { EdgeLayer } from "./canvas-scene-edges";
import { GRID_STEP } from "./canvas-snap";

export interface CanvasSceneInit {
  readonly rig: CanvasCameraRig;
  readonly content: CanvasSceneContent;
  readonly look: CardLook;
  readonly palette: ScenePalette;
  readonly dark: boolean;
  readonly timing: Timing;
  readonly reducedMotion: boolean;
  /** Which transform the gizmo on the selection shows, and along which axes. */
  readonly gizmo: GizmoChoice;
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
   * The meshes item `id` is drawn as, placed in three's world (canvas y
   * flipped): what a probe asks the depth buffer's question of — which drawn
   * surface a ray meets first.
   */
  bodiesOf(id: string): readonly Object3D[];
  /** Item ids whose face stands as a label in front of them (`canvas-scene-labels`). */
  readonly labels: readonly string[];
  /** A standing label's corners on the canvas, CSS pixels, clockwise from its top left; null when out of view. */
  labelOf(id: string): { x: number; y: number }[] | null;
}

export interface CanvasScene extends SceneHandle {
  setContent(content: CanvasSceneContent): void;
  setLook(look: CardLook, palette: ScenePalette, dark: boolean): void;
  /** Which transform the gizmo on the selection shows, and along which axes. */
  setGizmo(choice: GizmoChoice): void;
  /** The gizmo, as the gestures drive it. */
  readonly gizmo: SceneGizmo;
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
/** The dot radius of the floor's dot grid (its pitch is `GRID_STEP`), canvas units. */
const GRID_DOT = 1.1;

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
  toThree(pose.target, eye);
  toThree(pose.eye, camera.position);
  if (ortho) camera.position.sub(eye).setLength(ORTHO_EYE).add(eye);
  toThree(pose.up, camera.up);
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

/**
 * `gizmo` as the gestures drive it: each answer for the view as it is drawn
 * now, at the viewport's size, and the frame redrawn after it.
 */
function drivenGizmo(
  gizmo: GizmoLayer,
  view: () => CanvasView,
  size: ViewSize,
  redraw: () => void,
): SceneGizmo {
  const handled =
    <T>(run: (v: CanvasView, s: ViewSize, local: CanvasPoint) => T) =>
    (local: CanvasPoint): T => {
      const answer = run(view(), size, local);
      redraw();
      return answer;
    };
  return {
    hover: handled((v, s, local) => gizmo.hover(v, s, local)),
    press: handled((v, s, local) => gizmo.press(v, s, local)),
    drag: handled((v, s, local) => gizmo.drag(v, s, local)),
    release: () => {
      gizmo.release();
      redraw();
    },
  };
}

/** Every point of `points` on screen, or null when one is out of view. */
function allOnScreen(
  points: readonly Vector3[] | null,
  onScreen: (world: Vector3) => { x: number; y: number } | null,
): { x: number; y: number }[] | null {
  if (points === null) return null;
  const on = points.map(onScreen);
  return on.some((p) => p === null) ? null : on.filter((p) => p !== null);
}

/** What a mounted scene reads back: its layers as they last drew, through the camera as it is. */
function inspection(parts: {
  readonly stage: SceneStage;
  readonly cards: ItemLayer;
  readonly labels: LabelLayer;
  readonly edges: EdgeLayer;
  readonly content: CanvasSceneContent;
  readonly onScreen: (world: Vector3) => { x: number; y: number } | null;
}): CanvasSceneInspection {
  const { stage, cards, labels, edges, content, onScreen } = parts;
  return {
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
      const [a, , c] = drawn?.corners ?? [];
      if (a === undefined || c === undefined) return null;
      return onScreen(a.clone().add(c).multiplyScalar(0.5));
    },
    drawnOf: (id) => {
      const drawn = cards.drawn(id);
      const corners = allOnScreen(drawn?.corners ?? null, onScreen);
      return drawn === null || corners === null ? null : { z: drawn.z, corners };
    },
    bodiesOf: (id) => cards.bodiesOf(id),
    labels: labels.ids,
    labelOf: (id) => allOnScreen(labels.cornersOf(id), onScreen),
  };
}

/**
 * Turn what faces the camera — flat billboards, standing labels — to a view,
 * each time its orbit changes; a still camera, or one only panned or zoomed,
 * turns nothing.
 */
function cameraFacer(layers: readonly { face(axes: CanvasAxes): void }[]) {
  const faced = { yaw: Number.NaN, pitch: Number.NaN };
  return (view: CanvasView) => {
    if (view.yaw === faced.yaw && view.pitch === faced.pitch) return;
    faced.yaw = view.yaw;
    faced.pitch = view.pitch;
    const axes = viewAxes(view);
    for (const layer of layers) layer.face(axes);
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
  const labels = new LabelLayer(init.look);
  const edges = new EdgeLayer(init.look);
  const plane = canvasPlane();
  plane.setLook(init.look);
  scene.add(plane.mesh, edges.root, cards.root, labels.root);
  const gizmo = new GizmoLayer(scene, camera);
  let gizmoChoice: GizmoChoice = init.gizmo;
  let content = init.content;
  /** The selected items, which the gizmo stands on. */
  const selected = () => content.doc.nodes.filter((n) => content.selection.nodeIds.has(n.id));
  cards.sync(content);
  labels.sync(content);
  edges.sync(content);
  gizmo.setTarget(selected(), gizmoChoice);
  const { rig } = init;
  rig.wake = stage.invalidate;
  // The stage steps every frame by 0 under reduced motion; a flight must land instead.
  rig.setReducedMotion(init.reducedMotion);
  const viewport = { width: 1, height: 1 };
  const eye = new Vector3();

  const faceCamera = cameraFacer([cards, labels]);

  const frame = (dt: number) => {
    const moving = rig.step(dt);
    viewport.width = canvas.clientWidth || viewport.width;
    viewport.height = canvas.clientHeight || viewport.height;
    faceCamera(rig.view);
    const distance = applyView(camera, rig.view, viewport, eye);
    gizmo.follow(rig.view, viewport, rig.view.fov < MIN_FOV);
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
      labels.sync(content);
      edges.sync(content);
      gizmo.setTarget(selected(), gizmoChoice);
      stage.invalidate();
    },
    setGizmo: (choice: GizmoChoice) => {
      gizmoChoice = choice;
      gizmo.setTarget(selected(), gizmoChoice);
      stage.invalidate();
    },
    gizmo: drivenGizmo(gizmo, () => rig.view, viewport, stage.invalidate),
    setLook: (look: CardLook, palette: ScenePalette, dark: boolean) => {
      stage.setPalette(palette);
      plane.setLook(look);
      cards.setLook(look, dark);
      labels.setLook(look);
      edges.setLook(look);
      cards.sync(content);
      labels.sync(content);
      edges.sync(content);
      stage.invalidate();
    },
    inspect: () => inspection({ stage, cards, labels, edges, content, onScreen }),
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
      gizmo.dispose();
      edges.dispose();
      cards.dispose();
      labels.dispose();
      plane.dispose();
    },
  };
}
