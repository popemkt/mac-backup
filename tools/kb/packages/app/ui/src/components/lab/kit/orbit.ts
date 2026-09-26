/**
 * Orbit: fly round a subject (Lab principles M1, M3, M7).
 *
 * An orbit is the kit's pan (`PanControl`, drag with momentum) read as the
 * camera's bearing round a target, plus a distance the wheel or a pinch
 * dollies. The pan is the one drag mechanism; this adds only the dolly, the
 * target, and where those put the camera. The distance and the target ease
 * toward their goals (a dolly settles in the follow duration, a flight to a
 * new target in the arrive duration); under reduced motion both jump.
 *
 * A study may keep the press for itself (`grab`: a star, the sun) exactly as
 * it would under a pan.
 *
 * GAP [[01M3E9QZ3D6EG2W2MERM93ABNA]]: this belongs in the scene kit beside
 * the stage, where WP4 is folding the lab kit's view controls; it stands here
 * until that lands.
 */
import { approach, approachRate, type Timing } from "@/lib/timing";
import { PanControl, type Grab } from "@/components/lab/kit/pan-control";

interface Point {
  x: number;
  y: number;
  z: number;
}

/** What a camera must offer to be placed; three's cameras are this shape. */
interface Placeable {
  readonly position: { set(x: number, y: number, z: number): unknown };
  lookAt(x: number, y: number, z: number): void;
}

export interface OrbitLimits {
  /** Radians of turn per CSS pixel dragged. */
  readonly perPixel: number;
  /** The lowest and highest the camera may look from, radians above the target's horizon. */
  readonly pitch: readonly [number, number];
  readonly distance: readonly [number, number];
}

export interface OrbitHome {
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly target: Readonly<Point>;
}

/**
 * The eye of an orbit: `distance` from `target`, on the bearing `yaw`
 * (0 looks down −z from +z) and `pitch` (up is positive). Written into `out`.
 */
export function orbitEye(
  target: Readonly<Point>,
  yaw: number,
  pitch: number,
  distance: number,
  out: Point,
): void {
  const ring = Math.cos(pitch) * distance;
  out.x = target.x + Math.sin(yaw) * ring;
  out.y = target.y + Math.sin(pitch) * distance;
  out.z = target.z + Math.cos(yaw) * ring;
}

/** How far one wheel notch (100 units of delta) dollies, as a factor of the distance. */
const WHEEL = 0.0014;

export class OrbitControl {
  readonly control: PanControl;
  /** Where the camera looks now, and where a flight is taking it. */
  readonly target: Point;
  private readonly aim: Point;
  private readonly eye: Point = { x: 0, y: 0, z: 0 };
  distance: number;
  private goal: number;
  private readonly pitchCentre: number;
  private readonly limits: OrbitLimits;
  private readonly host: HTMLElement;
  private readonly dollyRate: number;
  private readonly flightRate: number;
  private readonly onChange: () => void;
  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const [near, far] = this.limits.distance;
    this.goal = Math.max(near, Math.min(far, this.goal * Math.exp(event.deltaY * WHEEL)));
    this.onChange();
  };

  constructor(
    host: HTMLElement,
    limits: OrbitLimits,
    home: OrbitHome,
    timing: Timing,
    callbacks: {
      onChange: () => void;
      onTap?: () => void;
      grab?: (x: number, y: number) => Grab | null;
    },
  ) {
    const [low, high] = limits.pitch;
    this.pitchCentre = (low + high) / 2;
    this.control = new PanControl(
      host,
      { perPixel: limits.perPixel, pitchLimit: (high - low) / 2 },
      callbacks,
    );
    this.control.pan.yaw = home.yaw;
    this.control.pan.pitch = home.pitch - this.pitchCentre;
    this.target = { ...home.target };
    this.aim = { ...home.target };
    this.distance = home.distance;
    this.goal = home.distance;
    this.limits = limits;
    this.host = host;
    this.dollyRate = approachRate(timing.follow);
    this.flightRate = approachRate(timing.arrive);
    this.onChange = callbacks.onChange;
    host.addEventListener("wheel", this.onWheel, { passive: false });
  }

  /** The camera's bearing now. */
  get yaw(): number {
    return this.control.pan.yaw;
  }

  get pitch(): number {
    return this.pitchCentre + this.control.pan.pitch;
  }

  /** Fly the target (and, given one, the distance) somewhere new. */
  flyTo(target: Readonly<Point>, distance?: number): void {
    this.aim.x = target.x;
    this.aim.y = target.y;
    this.aim.z = target.z;
    if (distance !== undefined) this.goal = distance;
    this.onChange();
  }

  /**
   * One frame: coast the pan, turn by `drift` rad/s while nothing holds it
   * (the one linear motion, M1), ease the dolly and the flight, and place
   * the camera.
   */
  frame(dt: number, reduced: boolean, camera: Placeable, drift = 0): void {
    this.control.frame(dt, reduced);
    const pan = this.control.pan;
    if (!reduced && !this.control.dragging && this.control.held === null) pan.yaw += drift * dt;
    const dolly = reduced ? 0 : dt * this.dollyRate;
    const flight = reduced ? 0 : dt * this.flightRate;
    this.distance = reduced ? this.goal : approach(this.distance, this.goal, 1, dolly);
    this.target.x = reduced ? this.aim.x : approach(this.target.x, this.aim.x, 1, flight);
    this.target.y = reduced ? this.aim.y : approach(this.target.y, this.aim.y, 1, flight);
    this.target.z = reduced ? this.aim.z : approach(this.target.z, this.aim.z, 1, flight);
    orbitEye(this.target, this.yaw, this.pitch, this.distance, this.eye);
    camera.position.set(this.eye.x, this.eye.y, this.eye.z);
    camera.lookAt(this.target.x, this.target.y, this.target.z);
  }

  dispose(): void {
    this.control.dispose();
    this.host.removeEventListener("wheel", this.onWheel);
  }
}
