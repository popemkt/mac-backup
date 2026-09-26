/**
 * Motion study: a floor of tiles that rise toward the pointer (`field.ts`),
 * seen from a near-isometric camera and lit by the kit's rig.
 *
 * Each tile draws its lift as height and its trailing glow as colour: the
 * hue family at rest, the accent where it has risen, so the eye reads the
 * wave's front (the lift) and its follow-through (the glow) separately. When
 * the pointer rests, a slow ambient source wanders the field over the
 * ambient period (M4) so the study is never dead, and never busy.
 */
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  Mesh,
  PlaneGeometry,
  Vector3,
} from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  float,
  instancedBufferAttribute,
  length,
  mix,
  positionLocal,
  uniform,
  vec3,
} from "three/tsl";
import type { LabControlValue, LabSceneInit, LabScene } from "@/components/lab/kit/contract";
import { PointerField } from "@/components/lab/kit/pointer";
import { createRig, finishMaterial } from "@/scene/gpu/rig";
import type { SceneStage } from "@/scene/gpu/stage";
import { mountStudy, type StudyContext, type StudyParts } from "@/components/lab/kit/study";
import { TileField } from "@/components/lab/motion/field";
import { labBackdrop } from "@/components/lab/kit/backdrop";
import { Entrance } from "@/components/lab/kit/entrance";

const SIDE = 22;
const SPACING = 0.56;
const TILE = 0.5;
/** How high a fully lifted tile rises, and the pointer's reach, in world units. */
const RISE = 1.1;
const REACH = 1.6;

function motion(stage: SceneStage, init: LabSceneInit, context: StudyContext): StudyParts {
  const field = new TileField(
    SIDE,
    SPACING,
    init.timing.follow,
    init.timing.stagger,
    init.timing.settle,
  );
  const state = new InstancedBufferAttribute(new Float32Array(field.count * 4), 4);
  state.setUsage(DynamicDrawUsage);
  for (let i = 0; i < field.count; i++) {
    state.array[i * 4] = field.centers[i * 2] ?? 0;
    state.array[i * 4 + 2] = field.centers[i * 2 + 1] ?? 0;
  }
  const s = instancedBufferAttribute(state);
  const entrance = new Entrance(init.timing);
  // Arriving, the tiles rise out of the floor from the centre outward.
  const risen = entrance.arrival(length(vec3(s.x, 0, s.z)).div((SIDE * SPACING) / 2));
  const sunk = float(1)
    .sub(risen)
    .mul(TILE * 1.2);
  const material = finishMaterial("satin");
  material.positionNode = positionLocal.add(
    vec3(
      s.x,
      s.y
        .mul(RISE)
        .add(TILE * 0.3)
        .sub(sunk),
      s.z,
    ),
  );
  material.colorNode = mix(stage.colors.hue.mul(0.62), stage.colors.accent, s.w.min(1));
  const tiles = new Mesh(new RoundedBoxGeometry(TILE, TILE * 0.6, TILE, 3, 0.06), material);
  tiles.count = field.count;
  tiles.frustumCulled = false;
  tiles.castShadow = true;
  tiles.receiveShadow = true;
  const floor = new Mesh(new PlaneGeometry(40, 40), finishMaterial("matte"));
  floor.material.colorNode = stage.colors.ground;
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const rig = createRig(stage, init.palette);
  rig.setKeyAngle(Math.PI * 0.75, 9, 7);
  stage.scene.add(tiles, floor, ...rig.lights);
  stage.camera.position.set(11, 11, 11);
  stage.camera.lookAt(0, 0, 0);
  const clock = uniform(0);
  stage.scene.backgroundNode = labBackdrop(stage.colors, float(clock), {
    focus: [0.5, 0.42],
    warmth: 0.2,
    haze: 0.45,
  });
  stage.atmosphere(14, 30);

  const pointer = new PointerField(context.host);
  const at = new Vector3();
  let elapsedIdle = 0;
  return {
    frame: (dt, elapsed) => {
      clock.value = elapsed;
      entrance.step(dt, context.reduced());
      if (dt <= 0) return;
      const idle = !pointer.inside || pointer.idleFor(performance.now()) > 3;
      if (idle) {
        elapsedIdle += dt;
        const w = (Math.PI * 2) / init.timing.ambientPeriod;
        at.set(Math.cos(elapsedIdle * w) * 3.2, 0, Math.sin(elapsedIdle * w * 2) * 2.2);
      } else if (!pointer.onPlane(stage.camera, "y", at)) {
        at.set(1e6, 0, 1e6);
      }
      field.step(dt, at.x, at.z, REACH);
      for (let i = 0; i < field.count; i++) {
        state.array[i * 4 + 1] = field.lift[i] ?? 0;
        state.array[i * 4 + 3] = field.glow[i] ?? 0;
      }
      state.needsUpdate = true;
    },
    setControl: (id, value: LabControlValue) => {
      if (id === "settle" && typeof value === "number") field.settle = value / 1000;
      if (id === "stagger" && typeof value === "number") field.stagger = value / 1000;
      if (id === "drive" && (value === "spring" || value === "ease")) field.drive = value;
      if (id === "overlap" && typeof value === "boolean") field.overlap = value;
    },
    setPalette: (palette) => rig.setPalette(palette),
    dispose: () => pointer.dispose(),
  };
}

export function mountMotion(host: HTMLElement, init: LabSceneInit): Promise<LabScene> {
  return mountStudy(
    host,
    init,
    { fov: 30, bloom: { strength: 0.3, radius: 0.4 }, shadows: true, vignette: 0.6 },
    motion,
  );
}
