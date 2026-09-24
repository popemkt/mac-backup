/**
 * Embers: equal spheres that heat by contact, glow, and pop (after the
 * threejs-journey WebGPU/TSL hero).
 *
 * The simulation is TSL compute (`compute.ts`) over storage buffers; the
 * sphere mesh is drawn `SHAPE.count` times and its node material reads
 * position, scale and temperature per instance straight from those buffers —
 * nothing crosses back to the CPU.
 *
 * Temperature is the only thing that varies a sphere's look; every sphere is
 * the same size. It maps through a blackbody-style ramp built from the
 * palette — the edge colour, the accent's ember, the accent, the accent run
 * toward white — whose gain rises with heat, so only the hot end is HDR and
 * only it crosses the bloom threshold (L2).
 *
 * The cloud's centre follows the pointer on a critically damped spring that
 * settles in the follow duration (M1, M5); the shell's softer springs lag
 * the core (M3). Distance fades into the ground (L3).
 */
import { Mesh, PointLight, SphereGeometry, Vector3 } from "three/webgpu";
import { instanceIndex, mix, positionLocal, smoothstep, uniform, vec3 } from "three/tsl";
import type { LabControlValue, LabSceneInit, LabScene } from "@/components/lab/kit/contract";
import { PointerField } from "@/components/lab/kit/pointer";
import { PointerVelocity } from "@/components/lab/kit/velocity";
import { createRig, labMaterial } from "@/components/lab/kit/rig";
import type { LabStage } from "@/components/lab/kit/stage";
import { mountStudy, type StudyContext, type StudyParts } from "@/components/lab/kit/study";
import { springRate, stepSpring, type Spring } from "@/components/lab/kit/timing";
import { emberSimulation, type EmberShape } from "@/components/lab/embers/compute";
import { PopGrants } from "@/components/lab/embers/pops";

const SHAPE: EmberShape = { count: 2600, sphere: 0.13, cloud: 3 };
const CAMERA_Z = 15;

/**
 * Rest offsets in a ball, from a seeded generator (the same cloud every
 * mount), no two closer than a sphere's diameter: spheres that overlapped at
 * rest would bump for ever and glow with no one stirring them.
 */
function homes(): Float32Array {
  let state = 0x9e3779b9;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  const out = new Float32Array(SHAPE.count * 3);
  const clear = (SHAPE.sphere * 2.1) ** 2;
  let placed = 0;
  for (let tries = 0; placed < SHAPE.count && tries < SHAPE.count * 60; tries++) {
    const r = SHAPE.cloud * Math.cbrt(random());
    const z = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - z * z);
    const x = r * ring * Math.cos(angle);
    const y = r * ring * Math.sin(angle);
    const w = r * z;
    let free = true;
    for (let j = 0; j < placed && free; j++) {
      const dx = (out[j * 3] ?? 0) - x;
      const dy = (out[j * 3 + 1] ?? 0) - y;
      const dz = (out[j * 3 + 2] ?? 0) - w;
      free = dx * dx + dy * dy + dz * dz >= clear;
    }
    if (free) out.set([x, y, w], placed++ * 3);
  }
  return out;
}

function embers(stage: LabStage, init: LabSceneInit, context: StudyContext): StudyParts {
  if (stage.backend !== "WebGPU") {
    // GAP [[01M3A95XAEE6FGT8ZVDRHYBDF5]]
    throw new Error(
      "Embers needs WebGPU: its collision grid uses storage atomics, which WebGL2 lacks.",
    );
  }
  const { colors } = stage;
  const sim = emberSimulation(homes(), SHAPE, init.timing);
  const { u, buffers: b } = sim;
  const look = b.state.element(instanceIndex);
  const t = look.w.min(1.6);
  const hot = mix(colors.accent, vec3(1, 1, 1), 0.6);
  const ember = colors.accent.mul(vec3(0.85, 0.28, 0.12));
  // Blackbody-style ramp, through the palette: edge → ember → accent → white-hot.
  const ramp = mix(
    mix(colors.edge, ember, smoothstep(0, 0.35, t)),
    mix(colors.accent, hot, smoothstep(0.7, 1, t)),
    smoothstep(0.3, 0.7, t),
  );
  const gain = uniform(3.2);
  const material = labMaterial("satin");
  material.positionNode = positionLocal
    .mul(look.z.mul(SHAPE.sphere))
    .add(b.position.element(instanceIndex));
  material.colorNode = mix(colors.hue.mul(0.35), colors.edge, 0.5);
  // Gain grows with t²: cold is barely lit, only the hot end runs past 1 (HDR).
  material.emissiveNode = ramp.mul(t.mul(t).mul(gain).add(t.mul(0.15)));
  const mesh = new Mesh(new SphereGeometry(1, 20, 14), material);
  mesh.count = SHAPE.count;
  mesh.frustumCulled = false;
  const core = new PointLight(undefined, 30, 0, 1.8);
  const rig = createRig(init.palette, false);
  rig.key.intensity = 0;
  stage.scene.add(mesh, core, ...rig.lights);
  stage.camera.position.set(0, 0, CAMERA_Z);
  stage.camera.lookAt(0, 0, 0);
  stage.backdrop();
  stage.atmosphere(CAMERA_Z - 1, CAMERA_Z + 7);

  const pointer = new PointerField(context.host);
  const grants = new PopGrants();
  const follow = springRate(init.timing.follow);
  const cx: Spring = { x: 0, v: 0 };
  const cy: Spring = { x: 0, v: 0 };
  const aim = new Vector3();
  const flick = new PointerVelocity();
  return {
    frame: (dt, elapsed) => {
      // A reduced-motion still is the cloud at rest: no step is dispatched.
      if (dt <= 0) return;
      const idle = !pointer.inside || pointer.idleFor(performance.now()) > 2.5;
      if (idle) {
        // Ambient drift: slow and small (M4), a figure of eight over the ambient period.
        const w = (Math.PI * 2) / init.timing.ambientPeriod;
        aim.set(Math.sin(elapsed * w) * 0.8, Math.sin(elapsed * w * 2) * 0.35, 0);
      } else {
        pointer.onPlane(stage.camera, "z", aim);
      }
      stepSpring(cx, aim.x, follow, dt);
      stepSpring(cy, aim.y, follow, dt);
      u.center.value.set(cx.x, cy.x, 0);
      // The ambient drift is not the pointer: it shoves nothing.
      flick.step(dt, idle ? null : aim);
      u.pointerVelocity.value.set(flick.x, flick.y, 0);
      if (idle) u.pointer.value.set(0, 0, 100);
      else u.pointer.value.set(aim.x, aim.y, 0);
      u.dt.value = dt;
      u.time.value = elapsed;
      u.grant.value = grants.next(dt);
      core.position.copy(u.center.value);
      void stage.renderer.compute(sim.passes);
    },
    setControl: (id, value: LabControlValue) => {
      if (typeof value !== "number") return;
      if (id === "gain") u.gain.value = value;
      if (id === "cooling") u.cooling.value = value;
      if (id === "threshold") u.threshold.value = value;
    },
    setPalette: (palette, dark) => {
      core.color.set(palette.accent);
      core.intensity = dark ? 30 : 16;
      gain.value = dark ? 3.2 : 2.4;
      rig.setPalette(palette);
    },
    dispose: () => {
      pointer.dispose();
      for (const pass of sim.passes) pass.dispose();
    },
  };
}

export function mountEmbers(host: HTMLElement, init: LabSceneInit): Promise<LabScene> {
  return mountStudy(host, init, { fov: 38, bloom: { strength: 0.85, radius: 0.5 } }, embers);
}
