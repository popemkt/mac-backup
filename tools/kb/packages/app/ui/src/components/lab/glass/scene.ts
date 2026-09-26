/**
 * Glass: liquid-glass metaballs, raymarched (`march.ts`), in a small studio
 * of soft light. Six blobs drift and a seventh follows the pointer
 * (`blobs.ts`); push it through the others to watch the smooth minimum melt
 * them together, and orbit to see the studio bend through them.
 *
 * The lessons are the sliders: `blend` is the smooth minimum's reach (0 is
 * hard spheres), `index` Snell's refractive index (1 is empty air, 1.5 glass,
 * 2.4 diamond), `dispersion` how far apart the three channels' indices sit,
 * `absorption` Beer–Lambert's density. On arrival the blobs grow in one by
 * one.
 */
import { Vector3 } from "three/webgpu";
import { float, uniform } from "three/tsl";
import type { LabControlValue, LabSceneInit, LabScene } from "@/components/lab/kit/contract";
import { numberOf } from "@/components/lab/kit/contract";
import { OrbitControl } from "@/components/lab/kit/orbit";
import { PointerField } from "@/components/lab/kit/pointer";
import { Entrance } from "@/components/lab/kit/entrance";
import type { SceneStage } from "@/scene/gpu/stage";
import { mountStudy, type StudyContext, type StudyParts } from "@/components/lab/kit/study";
import { BLOB_COUNT, BlobField } from "@/components/lab/glass/blobs";
import { blobUniforms, glassMesh } from "@/components/lab/glass/march";

const ORIGIN = { x: 0, y: 0, z: 0 };
/** The orbit's slow turn while nothing holds it (rad/s). */
const DRIFT = 0.02;

function glass(stage: SceneStage, init: LabSceneInit, context: StudyContext): StudyParts {
  const u = {
    blend: uniform(numberOf(init.values, "blend", 0.7)),
    ior: uniform(numberOf(init.values, "ior", 1.45)),
    dispersion: uniform(numberOf(init.values, "dispersion", 0.03)),
    density: uniform(numberOf(init.values, "density", 0.6)),
  };
  const entrance = new Entrance(init.timing);
  const blobs = blobUniforms();
  const field = new BlobField(init.timing);
  const arrivals = Array.from({ length: BLOB_COUNT }, (_, i) =>
    entrance.arrival(float(i / (BLOB_COUNT - 1))),
  );
  stage.scene.add(
    glassMesh(stage.colors, blobs, {
      blend: float(u.blend),
      ior: float(u.ior),
      dispersion: float(u.dispersion),
      density: float(u.density),
      grown: (i) => arrivals[i] ?? float(1),
    }),
  );
  const orbit = new OrbitControl(
    context.host,
    { perPixel: 0.005, pitch: [-0.3, 1.0], distance: [5, 16] },
    { yaw: 0.35, pitch: 0.18, distance: 9, target: ORIGIN },
    init.timing,
    { onChange: () => stage.invalidate() },
  );
  const pointer = new PointerField(context.host);
  const aim = new Vector3();
  const through = new Vector3();

  return {
    frame: (dt, elapsed) => {
      const reduced = context.reduced();
      entrance.step(dt, reduced);
      orbit.frame(dt, reduced, stage.camera, DRIFT);
      const live =
        pointer.inside &&
        !orbit.control.dragging &&
        pointer.idleFor(performance.now()) <= 2.5 &&
        pointer.onFacing(stage.camera, through.set(0, 0, 0), aim);
      field.step(dt, elapsed, live ? aim : null);
      for (let i = 0; i < BLOB_COUNT; i++) {
        const blob = field.blobs[i];
        if (blob !== undefined) blobs.values[i]?.set(blob.x, blob.y, blob.z, blob.radius);
      }
    },
    setControl: (id, value: LabControlValue) => {
      if (typeof value !== "number") return;
      if (id === "blend") u.blend.value = value;
      if (id === "ior") u.ior.value = value;
      if (id === "dispersion") u.dispersion.value = value;
      if (id === "density") u.density.value = value;
    },
    dispose: () => {
      pointer.dispose();
      orbit.dispose();
    },
  };
}

export function mountGlass(host: HTMLElement, init: LabSceneInit): Promise<LabScene> {
  return mountStudy(
    host,
    init,
    { fov: 40, bloom: { strength: 0.6, radius: 0.5 }, vignette: 0.45 },
    glass,
  );
}
