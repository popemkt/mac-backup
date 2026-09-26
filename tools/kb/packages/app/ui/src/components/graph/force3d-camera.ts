/**
 * The 3D graph's camera: who owns it, and where it flies (Lab principles M1,
 * M5). While the layout settles and nobody has taken the camera, it follows
 * the layout's fit; a selection flies it to the node's 1-hop neighbourhood on
 * critically damped springs (`force3d-flight`); fit, zoom and search jumps
 * fly the same way; the user's first orbit takes it, and a flight owns it
 * until it lands. Otherwise the orbit does, with its damping and the ambient
 * turn, both of which reduced motion stops.
 */
import type { PerspectiveCamera } from "three/webgpu";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { GraphCameraControls } from "./graph-camera-controls";
import { CameraFlight, dollyGoal, fitGoal, neighbourhoodGoal, type Vec3 } from "./force3d-flight";

/** The fit leaves this much of the frame around the graph. */
const FIT_PADDING = 0.8;
/** A fly-to frames the node's 1-hop neighbourhood with this much margin, never nearer. */
const FOCUS_PADDING = 1.25;
const FOCUS_NEAREST = 160;

/** Where the graph's nodes are now: what the camera frames. */
export interface GraphPlaces {
  readonly positions: () => Float32Array;
  readonly count: () => number;
  /** A node's index, or -1. */
  readonly indexOf: (id: string) => number;
  readonly neighbours: (i: number) => readonly number[];
  readonly radius: (i: number) => number;
  readonly labelOf: (id: string) => string | undefined;
}

function copyInto(out: Vec3, from: { x: number; y: number; z: number }): void {
  out.x = from.x;
  out.y = from.y;
  out.z = from.z;
}

export class GraphCamera {
  private readonly flight: CameraFlight;
  private readonly goal = { eye: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 } };
  private readonly view: {
    readonly fov: number;
    aspect: number;
    readonly eye: Vec3;
    readonly look: Vec3;
  };
  private readonly focusPoint = { x: 0, y: 0, z: 0 };
  /** The user has moved the camera: the fit stops following the layout. */
  private taken = false;
  private flyTo: string | null = null;

  private readonly camera: PerspectiveCamera;
  private readonly orbit: OrbitControls;
  private readonly places: GraphPlaces;
  private readonly wake: () => void;

  constructor(
    rig: { readonly camera: PerspectiveCamera; readonly orbit: OrbitControls },
    places: GraphPlaces,
    follow: number,
    wake: () => void,
  ) {
    const { camera, orbit } = rig;
    this.camera = camera;
    this.orbit = orbit;
    this.places = places;
    this.wake = wake;
    this.flight = new CameraFlight(follow);
    this.view = {
      fov: camera.fov,
      aspect: 1,
      eye: { x: 0, y: 0, z: 0 },
      look: { x: 0, y: 0, z: 0 },
    };
    orbit.addEventListener("start", () => {
      this.taken = true;
      this.flyTo = null;
      this.flight.cancel();
      wake();
    });
    orbit.addEventListener("change", wake);
  }

  get flying(): boolean {
    return this.flight.active;
  }

  private readView(): void {
    this.view.aspect = this.camera.aspect;
    copyInto(this.view.eye, this.camera.position);
    copyInto(this.view.look, this.orbit.target);
  }

  private fly(): void {
    this.readView();
    this.flight.start(this.view.eye, this.view.look, this.goal.eye, this.goal.look);
    this.wake();
  }

  private fitGoal(): void {
    this.readView();
    fitGoal(this.places.positions(), this.places.count(), this.view, FIT_PADDING, this.goal);
  }

  /** Frame the whole graph; `follow` hands the camera back to the layout. */
  fit(follow: boolean): void {
    this.taken = !follow;
    this.flyTo = null;
    this.fitGoal();
    this.fly();
  }

  private aimAt(id: string): boolean {
    const i = this.places.indexOf(id);
    if (i < 0) return false;
    const positions = this.places.positions();
    this.focusPoint.x = positions[i * 3] ?? 0;
    this.focusPoint.y = positions[i * 3 + 1] ?? 0;
    this.focusPoint.z = positions[i * 3 + 2] ?? 0;
    this.readView();
    neighbourhoodGoal(
      positions,
      { node: i, neighbours: [...this.places.neighbours(i)] },
      this.view,
      { radius: this.places.radius(i) * 2, padding: FOCUS_PADDING, nearest: FOCUS_NEAREST },
      this.goal,
    );
    return true;
  }

  /** Fly to a node's neighbourhood, and keep aiming while the layout moves it. */
  focus(id: string): void {
    this.taken = true;
    this.flyTo = id;
    if (this.aimAt(id)) this.fly();
  }

  dolly(scale: number): void {
    this.taken = true;
    this.flyTo = null;
    this.readView();
    dollyGoal(this.view, scale, this.goal);
    this.fly();
  }

  /** Fly or orbit for `dt`; whether the camera moved. */
  step(dt: number, reduced: boolean, laying: boolean, autorotate: boolean): boolean {
    if (laying && !this.taken) {
      this.fitGoal();
      this.flight.start(this.view.eye, this.view.look, this.goal.eye, this.goal.look);
    } else if (this.flyTo !== null && laying && this.aimAt(this.flyTo)) {
      this.flight.retarget(this.goal.eye, this.goal.look);
    }
    const wasFlying = this.flight.active;
    const flying = this.flight.step(dt, reduced);
    if (wasFlying) {
      this.camera.position.set(this.flight.eye.x, this.flight.eye.y, this.flight.eye.z);
      this.orbit.target.set(this.flight.look.x, this.flight.look.y, this.flight.look.z);
      this.camera.lookAt(this.orbit.target);
    }
    // A flight owns the camera; otherwise the orbit does.
    this.orbit.autoRotate = autorotate && !reduced;
    const orbiting = !flying && this.orbit.update(dt);
    return flying || orbiting;
  }

  /** The toolbar's handle on this camera. */
  controls(): GraphCameraControls {
    return {
      fit: () => this.fit(false),
      reset: () => this.fit(true),
      zoomIn: () => this.dolly(0.7),
      zoomOut: () => this.dolly(1.4),
      focusNode: (id) => this.focus(id),
      labelOf: (id) => this.places.labelOf(id),
    };
  }
}
