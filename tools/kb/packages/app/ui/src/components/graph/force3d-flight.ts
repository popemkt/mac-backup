/**
 * The 3D graph's camera flight: the eye and the point it looks at, each a
 * critically damped spring per axis (Lab principles M1, M5), so a fly-to on
 * select, a fit, a zoom or a search jump starts on the next frame, never
 * overshoots, and settles in `--motion-duration-follow`. A goal may move
 * while the flight is under way (the node is still being laid out); the
 * springs carry their velocity across, so retargeting never jolts. Under
 * reduced motion a flight is a cut (M7).
 *
 * Pure arithmetic, no three: the scene reads `eye` and `look` after `step`.
 */
import { springRate, stepSpring, type Spring } from "@/lib/timing";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Within this distance of its goal, and slower than this, a flight has landed. */
const LANDED = 1e-3;

function springs(): [Spring, Spring, Spring] {
  return [
    { x: 0, v: 0 },
    { x: 0, v: 0 },
    { x: 0, v: 0 },
  ];
}

export class CameraFlight {
  /** Where the camera is, and what it looks at, after the latest step. */
  readonly eye: Vec3 = { x: 0, y: 0, z: 0 };
  readonly look: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly eyeSprings = springs();
  private readonly lookSprings = springs();
  private readonly eyeGoal: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly lookGoal: Vec3 = { x: 0, y: 0, z: 0 };
  private flying = false;
  private readonly rate: number;

  /** `seconds`: how long a flight takes to settle. */
  constructor(seconds: number) {
    this.rate = springRate(seconds);
  }

  get active(): boolean {
    return this.flying;
  }

  /** Fly from where the camera is now toward a goal. */
  start(eye: Vec3, look: Vec3, eyeGoal: Vec3, lookGoal: Vec3): void {
    if (!this.flying) {
      seat(this.eyeSprings, eye);
      seat(this.lookSprings, look);
    }
    this.retarget(eyeGoal, lookGoal);
  }

  /** Move the goal of a flight under way (or of the next one). */
  retarget(eyeGoal: Vec3, lookGoal: Vec3): void {
    copy(this.eyeGoal, eyeGoal);
    copy(this.lookGoal, lookGoal);
    this.flying = true;
  }

  /** The user took the camera: stop where it is. */
  cancel(): void {
    this.flying = false;
  }

  /** Advance by `dt` seconds; `reduced` lands at once. Returns whether it still flies. */
  step(dt: number, reduced: boolean): boolean {
    if (!this.flying) return false;
    if (reduced) {
      land(this.eyeSprings, this.eyeGoal);
      land(this.lookSprings, this.lookGoal);
    } else {
      advance(this.eyeSprings, this.eyeGoal, this.rate, dt);
      advance(this.lookSprings, this.lookGoal, this.rate, dt);
    }
    read(this.eyeSprings, this.eye);
    read(this.lookSprings, this.look);
    const scale = Math.max(1, distance(this.eyeGoal, this.lookGoal));
    const settled =
      landed(this.eyeSprings, this.eyeGoal, scale) &&
      landed(this.lookSprings, this.lookGoal, scale);
    if (settled) {
      land(this.eyeSprings, this.eyeGoal);
      land(this.lookSprings, this.lookGoal);
      read(this.eyeSprings, this.eye);
      read(this.lookSprings, this.look);
    }
    this.flying = !settled;
    return this.flying;
  }
}

function seat(s: [Spring, Spring, Spring], at: Vec3): void {
  s[0].x = at.x;
  s[1].x = at.y;
  s[2].x = at.z;
  s[0].v = 0;
  s[1].v = 0;
  s[2].v = 0;
}

function land(s: [Spring, Spring, Spring], goal: Vec3): void {
  seat(s, goal);
}

function advance(s: [Spring, Spring, Spring], goal: Vec3, rate: number, dt: number): void {
  stepSpring(s[0], goal.x, rate, dt);
  stepSpring(s[1], goal.y, rate, dt);
  stepSpring(s[2], goal.z, rate, dt);
}

function read(s: [Spring, Spring, Spring], out: Vec3): void {
  out.x = s[0].x;
  out.y = s[1].x;
  out.z = s[2].x;
}

function landed(s: [Spring, Spring, Spring], goal: Vec3, scale: number): boolean {
  const gap = Math.hypot(s[0].x - goal.x, s[1].x - goal.y, s[2].x - goal.z);
  const speed = Math.hypot(s[0].v, s[1].v, s[2].v);
  return gap < LANDED * scale && speed < LANDED * scale * 10;
}

function copy(out: Vec3, from: Vec3): void {
  out.x = from.x;
  out.y = from.y;
  out.z = from.z;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * The smallest sphere a fit frames, world units: a graph of a few nodes, or
 * of edgeless ones seeded close together, is seen at a node's scale, never
 * with its nodes filling the frame.
 */
const FIT_MIN_RADIUS = 120;

/**
 * The goal that frames every point: look at the centre of their bounding
 * sphere from the camera's current direction, far enough back that the
 * sphere fits the narrower field of view with `padding` to spare.
 */
export function fitGoal(
  positions: Float32Array,
  count: number,
  view: { readonly fov: number; readonly aspect: number; readonly eye: Vec3; readonly look: Vec3 },
  padding: number,
  out: { eye: Vec3; look: Vec3 },
): void {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3] ?? 0;
    const y = positions[i * 3 + 1] ?? 0;
    const z = positions[i * 3 + 2] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (count === 0) {
    minX = minY = minZ = maxX = maxY = maxZ = 0;
  }
  out.look.x = (minX + maxX) / 2;
  out.look.y = (minY + maxY) / 2;
  out.look.z = (minZ + maxZ) / 2;
  const radius = Math.max(FIT_MIN_RADIUS, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  const vertical = (view.fov * Math.PI) / 360;
  const narrow = Math.min(vertical, Math.atan(Math.tan(vertical) * view.aspect));
  const back = (radius * padding) / Math.sin(narrow);
  towards(view.eye, view.look, out.look, back, out.eye);
}

/**
 * The goal that frames a node with its neighbourhood: look at the node, from
 * the current direction, far enough back that a sphere round it reaching its
 * farthest neighbour (plus its own `radius`) fits the narrower field of view
 * with `padding` to spare — never nearer than `nearest`. The frame follows the
 * neighbourhood's real size, so a hub and a leaf are both seen whole.
 */
export function neighbourhoodGoal(
  positions: Float32Array,
  { node, neighbours }: { readonly node: number; readonly neighbours: readonly number[] },
  view: { readonly fov: number; readonly aspect: number; readonly eye: Vec3; readonly look: Vec3 },
  frame: { readonly radius: number; readonly padding: number; readonly nearest: number },
  out: { eye: Vec3; look: Vec3 },
): void {
  const x = positions[node * 3] ?? 0;
  const y = positions[node * 3 + 1] ?? 0;
  const z = positions[node * 3 + 2] ?? 0;
  let reach = frame.radius;
  for (const other of neighbours) {
    const d = Math.hypot(
      (positions[other * 3] ?? 0) - x,
      (positions[other * 3 + 1] ?? 0) - y,
      (positions[other * 3 + 2] ?? 0) - z,
    );
    if (d + frame.radius > reach) reach = d + frame.radius;
  }
  const vertical = (view.fov * Math.PI) / 360;
  const narrow = Math.min(vertical, Math.atan(Math.tan(vertical) * view.aspect));
  out.look.x = x;
  out.look.y = y;
  out.look.z = z;
  towards(
    view.eye,
    view.look,
    out.look,
    Math.max(frame.nearest, (reach * frame.padding) / Math.sin(narrow)),
    out.eye,
  );
}

/** The goal that dollies the eye toward (scale < 1) or away from what it looks at. */
export function dollyGoal(
  view: { readonly eye: Vec3; readonly look: Vec3 },
  scale: number,
  out: { eye: Vec3; look: Vec3 },
): void {
  copy(out.look, view.look);
  out.eye.x = view.look.x + (view.eye.x - view.look.x) * scale;
  out.eye.y = view.look.y + (view.eye.y - view.look.y) * scale;
  out.eye.z = view.look.z + (view.eye.z - view.look.z) * scale;
}

/** `centre` backed off by `back` along the direction the camera looks from. */
function towards(eye: Vec3, look: Vec3, centre: Vec3, back: number, out: Vec3): void {
  let dx = eye.x - look.x;
  let dy = eye.y - look.y;
  let dz = eye.z - look.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) {
    dx = 0;
    dy = 0;
    dz = 1;
  } else {
    dx /= length;
    dy /= length;
    dz /= length;
  }
  out.x = centre.x + dx * back;
  out.y = centre.y + dy * back;
  out.z = centre.z + dz * back;
}
