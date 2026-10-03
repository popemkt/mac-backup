/**
 * The 3D canvas's transform gizmo (plan 2026-10-02, decisions 10 and 15):
 * three's `TransformControls`, built with no DOM element, so it adds no
 * listeners and never competes with kb's own pointer. The scene's gestures
 * drive it through `SceneGizmo` (`canvas-gizmo`): each press, drag and hover
 * hands it the camera model's own ray (`screenRay`), canvas y flipped
 * (`canvas-scene-space`).
 *
 * It moves a stand-in object placed on the selection — at its pivot, the
 * centre of the box bounding it (`selectionPivot`), turned with the first
 * item in local space — and reads the stand-in's motion back as one
 * `CanvasTransform` in canvas space: a move, a turn and a stretch about the
 * pivot. It writes nothing; the pointer reducer previews the transform and
 * writes it on release, snapping its turn, so the controls' own snapping
 * stays off and snapping has one owner (`canvas-snap`).
 *
 * An orthographic view is drawn by the stage's perspective camera with an
 * orthographic projection, from far back; the controls size their handles,
 * and pace a turn, from the camera they are given and its distance, so in
 * that lens they are given an orthographic twin looking the same way from a
 * screen's height away.
 */
import {
  Matrix4,
  Object3D,
  OrthographicCamera,
  Vector3,
  type PerspectiveCamera,
  type Quaternion,
  type Scene,
} from "three/webgpu";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {
  boxFrame,
  selectionPivot,
  type CanvasNode,
  type CanvasTransform,
  type CanvasVec,
} from "@kb/canvas";
import { screenRay, type CanvasPoint, type CanvasView, type ViewSize } from "./canvas-camera";
import type { GizmoChoice, GizmoMode } from "./canvas-gizmo";
import { fromThree, matrixFromThree, matrixToThree, toThree } from "./canvas-scene-space";

/** Each gizmo mode as the controls name it. */
const CONTROLS_MODE = { move: "translate", rotate: "rotate", scale: "scale" } as const satisfies {
  readonly [M in GizmoMode]: string;
};

/** Where a drag began: the stand-in's place and turn, and the pivot in canvas space. */
interface Grip {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
  readonly pivot: CanvasVec;
}

export class GizmoLayer {
  private readonly controls: TransformControls;
  /** The stand-in the controls move: never drawn. */
  private readonly proxy = new Object3D();
  private readonly ortho = new OrthographicCamera();
  private readonly turn = new Matrix4();
  private readonly ray = { origin: new Vector3(), dir: new Vector3() };
  private grip: Grip | null = null;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;

  constructor(scene: Scene, camera: PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    this.controls = new TransformControls(camera);
    this.controls.detach();
    scene.add(this.proxy, this.controls.getHelper());
  }

  /**
   * Stand the gizmo on `items` (the selection), as `choice` says; with none,
   * hide it. A drag under way keeps its stand-in where the drag has it.
   */
  setTarget(items: readonly CanvasNode[], choice: GizmoChoice): void {
    if (this.grip !== null) return;
    const lead = items[0];
    if (lead === undefined) {
      this.controls.detach();
      return;
    }
    toThree(selectionPivot(items), this.proxy.position);
    // Local space turns the handles with the first item, for every item selected;
    // Blender gives each its own axes.
    // GAP [[01M41W57GRNCMBJG1RYJQTA68P]]
    if (choice.space === "local") {
      this.proxy.quaternion.setFromRotationMatrix(matrixToThree(boxFrame(lead).matrix, this.turn));
    } else this.proxy.quaternion.identity();
    this.proxy.scale.set(1, 1, 1);
    this.proxy.updateMatrixWorld(true);
    this.controls.setMode(CONTROLS_MODE[choice.mode]);
    this.controls.setSpace(choice.space === "local" ? "local" : "world");
    if (this.controls.object !== this.proxy) this.controls.attach(this.proxy);
  }

  /** Give the controls the camera that draws `view`: the stage's, or its orthographic twin. */
  follow(view: CanvasView, size: ViewSize, orthographic: boolean): void {
    if (!orthographic) {
      if (this.controls.camera !== this.camera) this.controls.camera = this.camera;
      return;
    }
    const { ortho } = this;
    const away = size.height / view.zoom;
    const back = this.ray.dir.set(0, 0, 1).applyQuaternion(this.camera.quaternion);
    toThree(view, ortho.position).addScaledVector(back, away);
    ortho.quaternion.copy(this.camera.quaternion);
    ortho.left = -size.width / 2 / view.zoom;
    ortho.right = size.width / 2 / view.zoom;
    ortho.top = size.height / 2 / view.zoom;
    ortho.bottom = -size.height / 2 / view.zoom;
    ortho.near = away * 0.01;
    ortho.far = away * 100;
    ortho.updateProjectionMatrix();
    ortho.updateMatrixWorld();
    if (this.controls.camera !== ortho) this.controls.camera = ortho;
  }

  /** Aim the controls' picking along the camera model's ray through `local`. */
  private aim(view: CanvasView, size: ViewSize, local: CanvasPoint): void {
    const { origin, dir } = screenRay(view, size, local);
    this.controls
      .getRaycaster()
      .ray.set(toThree(origin, this.ray.origin), toThree(dir, this.ray.dir));
    this.controls.getHelper().updateMatrixWorld(true);
  }

  hover(view: CanvasView, size: ViewSize, local: CanvasPoint): boolean {
    // Detached, the controls hide their helper and have nothing to take hold of.
    if (!this.controls.getHelper().visible) return false;
    this.aim(view, size, local);
    this.controls.pointerHover(null);
    return this.controls.axis !== null;
  }

  press(view: CanvasView, size: ViewSize, local: CanvasPoint): boolean {
    if (!this.hover(view, size, local)) return false;
    this.controls.pointerDown(null);
    if (!this.controls.dragging) return false;
    this.grip = {
      position: this.proxy.position.clone(),
      quaternion: this.proxy.quaternion.clone(),
      pivot: fromThree(this.proxy.position),
    };
    return true;
  }

  drag(view: CanvasView, size: ViewSize, local: CanvasPoint): CanvasTransform | null {
    const { grip } = this;
    if (grip === null) return null;
    this.aim(view, size, local);
    this.controls.pointerMove(null);
    const moved = fromThree(this.proxy.position.clone().sub(grip.position));
    const delta = this.proxy.quaternion.clone().multiply(grip.quaternion.clone().invert());
    const { scale } = this.proxy;
    return {
      pivot: grip.pivot,
      move: moved,
      turn: matrixFromThree(this.turn.makeRotationFromQuaternion(delta)),
      axes: matrixFromThree(this.turn.makeRotationFromQuaternion(grip.quaternion)),
      stretch: { x: Math.abs(scale.x), y: Math.abs(scale.y), z: Math.abs(scale.z) },
    };
  }

  release(): void {
    this.controls.pointerUp(null);
    this.grip = null;
  }

  dispose(): void {
    this.controls.detach();
    // The controls' own `dispose` unhooks a DOM element they were never given.
    this.controls.getHelper().dispose();
    this.scene.remove(this.proxy, this.controls.getHelper());
  }
}
