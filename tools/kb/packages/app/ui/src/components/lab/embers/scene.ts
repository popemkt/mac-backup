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
 * the same size. It maps through `heat.ts`'s curve — a blackbody-style ramp
 * from dark maroon through the accent's ember and the accent to white-hot —
 * whose gain rises with heat, so only the hot end is HDR and only it crosses
 * the bloom threshold (L2). The resting glow is derived here from where a
 * sphere is and capped, every frame, below the point where it would bloom
 * for the accent and gain being shaded with; the warm rest comes from
 * the lights and the sub-threshold emissive.
 *
 * The cloud's centre follows the pointer (`steer.ts`); the shell's softer
 * springs lag the core (M3). Distance fades into the ground (L3).
 */
import { Mesh, PointLight, SphereGeometry, Vector3 } from "three/webgpu";
import { float, instanceIndex, mix, positionLocal, uniform, vec3 } from "three/tsl";
import type { LabControlValue, LabSceneInit, LabScene } from "@/components/lab/kit/contract";
import { PointerField } from "@/components/lab/kit/pointer";
import { createRig, finishMaterial } from "@/scene/gpu/rig";
import type { SceneStage } from "@/scene/gpu/stage";
import { mountStudy, type StudyContext, type StudyParts } from "@/components/lab/kit/study";
import { emberSimulation, restFloor, type EmberShape } from "@/components/lab/embers/compute";
import { PopGrants } from "@/components/lab/embers/pops";
import { EmberSteer } from "@/components/lab/embers/steer";
import {
  EMBER_TINT,
  HEAT_GAIN,
  RestCeiling,
  displayTemperature,
  heatEmissive,
} from "@/components/lab/embers/heat";
import { NODE_OPS } from "@/scene/gpu/tsl";

const SHAPE: EmberShape = { count: 3400, sphere: 0.1, cloud: 3.4 };
const CAMERA_Z = 17;

/**
 * Rest offsets in a ball, from a seeded generator (the same cloud every
 * mount), no two closer than 1.3 diameters: spheres that overlapped at rest
 * would bump for ever and glow with no one stirring them. Denser at the core
 * and thinning past the rim, so the cloud has no hard outline (P1).
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
  const clear = (SHAPE.sphere * 2.6) ** 2;
  let placed = 0;
  for (let tries = 0; placed < SHAPE.count && tries < SHAPE.count * 60; tries++) {
    const r = SHAPE.cloud * random() ** 0.45 * (1 + 0.3 * random() ** 4);
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

function embers(stage: SceneStage, init: LabSceneInit, context: StudyContext): StudyParts {
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
  const place = b.position.element(instanceIndex);
  const gain = uniform<number>(HEAT_GAIN.dark);
  // The cap on the resting glow, solved each frame for the accent and gain
  // that frame is shaded with, and applied here, where the colour is made.
  const ceiling = uniform(0);
  const ceilings = new RestCeiling();
  const t = displayTemperature(
    NODE_OPS,
    look.w,
    restFloor(u, place, SHAPE.cloud),
    float(ceiling),
  ).min(1.6);
  const ember = colors.accent.mul(vec3(...EMBER_TINT));
  const material = finishMaterial("satin");
  material.positionNode = positionLocal.mul(look.z.mul(SHAPE.sphere)).add(place);
  material.colorNode = mix(ember.mul(0.3), colors.hue.mul(0.2), 0.3);
  material.emissiveNode = heatEmissive(NODE_OPS, vec3(colors.accent), t, float(gain));
  const mesh = new Mesh(new SphereGeometry(1, 20, 14), material);
  mesh.count = SHAPE.count;
  mesh.frustumCulled = false;
  const core = new PointLight(undefined, 45, 0, 2);
  // The rig, warmed: a low key and a strong rim, both in the accent, give the
  // spheres form from the core outward rather than reading as holes.
  const rig = createRig(init.palette, false);
  rig.key.intensity = 0.3;
  rig.rim.intensity = 1.6;
  stage.scene.add(mesh, core, ...rig.lights);
  stage.camera.position.set(0, 0, CAMERA_Z);
  stage.camera.lookAt(0, 0, 0);
  stage.backdrop();
  stage.atmosphere(CAMERA_Z - 1, CAMERA_Z + 7);

  const pointer = new PointerField(context.host);
  const grants = new PopGrants();
  const steer = new EmberSteer(init.timing);
  const aim = new Vector3();
  return {
    frame: (dt, elapsed) => {
      // Every frame, stepped or frozen: the stage has eased its colours by now.
      ceiling.value = ceilings.for(colors.accent.value, gain.value);
      const live = pointer.inside && pointer.idleFor(performance.now()) <= 2.5;
      const onPlane = live && pointer.onPlane(stage.camera, "z", aim);
      // A zero step (a restart, or reduced motion's still) steps nothing and
      // dispatches nothing; the steer forgets the pointer's speed across it.
      if (!steer.frame(dt, elapsed, onPlane ? aim : null)) return;
      u.center.value.set(steer.center.x, steer.center.y, 0);
      u.pointerVelocity.value.set(steer.velocity.x, steer.velocity.y, 0);
      u.pointer.value.set(steer.pointer.x, steer.pointer.y, steer.pointer.z);
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
      core.intensity = dark ? 45 : 20;
      gain.value = dark ? HEAT_GAIN.dark : HEAT_GAIN.light;
      rig.setPalette(palette);
      rig.key.color.set(palette.accent);
      rig.rim.color.set(palette.accent);
    },
    dispose: () => {
      pointer.dispose();
      for (const pass of sim.passes) pass.dispose();
    },
  };
}

export function mountEmbers(host: HTMLElement, init: LabSceneInit): Promise<LabScene> {
  return mountStudy(host, init, { fov: 38, bloom: { strength: 1.15, radius: 0.65 } }, embers);
}
