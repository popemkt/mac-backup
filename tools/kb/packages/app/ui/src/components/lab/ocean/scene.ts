/**
 * Ocean: a sea of Gerstner waves (`waves.ts`) under a low sun, the sky and
 * the water shaded from one sky function (`shaders.ts`).
 *
 * The sliders are the lessons: `waves` is the total steepness (at 1 the
 * crests would fold), `wavelength` the longest swell (long waves travel
 * faster: watch the chop overtaken), `sun` its height (a glitter path on the
 * water, the aureole, the clouds lit from below), and foam where the crests
 * pinch. Orbit to look along the glitter path or away from it. Arriving, the
 * sea rises from calm.
 */
import { Vector3 } from "three/webgpu";
import { float, uniform, vec3 } from "three/tsl";
import type { LabControlValue, LabSceneInit, LabScene } from "@/components/lab/kit/contract";
import { numberOf } from "@/components/lab/kit/contract";
import { OrbitControl } from "@/components/lab/kit/orbit";
import { Entrance } from "@/components/lab/kit/entrance";
import type { SceneStage } from "@/scene/gpu/stage";
import { mountStudy, type StudyContext, type StudyParts } from "@/components/lab/kit/study";
import { waveSet } from "@/components/lab/ocean/waves";
import { sea, skyDome, skyFunction, waveUniforms } from "@/components/lab/ocean/shaders";

/** The sun's bearing, radians from −z (a little right of straight ahead). */
const SUN_BEARING = 0.18;
const WIND = 0.35;
const DRIFT = 0.004;

function sunDirection(degrees: number, out: Vector3): Vector3 {
  const elevation = (degrees * Math.PI) / 180;
  return out.set(
    Math.sin(SUN_BEARING) * Math.cos(elevation),
    Math.sin(elevation),
    -Math.cos(SUN_BEARING) * Math.cos(elevation),
  );
}

function ocean(stage: SceneStage, init: LabSceneInit, context: StudyContext): StudyParts {
  const state = {
    height: numberOf(init.values, "height", 0.55),
    wavelength: numberOf(init.values, "wavelength", 14),
  };
  const time = uniform(0);
  const sun = uniform(sunDirection(numberOf(init.values, "sun", 6), new Vector3()));
  const foam = uniform(init.values["foam"] === false ? 0 : 1);
  const entrance = new Entrance(init.timing);
  const waves = waveUniforms();
  const setWaves = () => waves.set(waveSet(state.height, state.wavelength, WIND));
  setWaves();
  const u = {
    time: float(time),
    sun: vec3(sun),
    swell: entrance.arrival(float(0)),
    foam: float(foam),
  };
  // One sky definition; each material builds its own instance of the WGSL
  // function, since a layout function's uniforms bind per material.
  const sky = () => skyFunction(stage.colors, u);
  const dome = skyDome(sky());
  stage.scene.add(dome, sea(stage.colors, sky(), waves, u));
  const orbit = new OrbitControl(
    context.host,
    { perPixel: 0.004, pitch: [0.04, 0.7], distance: [6, 45] },
    { yaw: 0, pitch: 0.16, distance: 18, target: { x: 0, y: 1.2, z: 0 } },
    init.timing,
    { onChange: () => stage.invalidate() },
  );

  return {
    frame: (dt, elapsed) => {
      const reduced = context.reduced();
      entrance.step(dt, reduced);
      orbit.frame(dt, reduced, stage.camera, DRIFT);
      dome.position.copy(stage.camera.position);
      time.value = elapsed;
    },
    setControl: (id, value: LabControlValue) => {
      if (id === "foam" && typeof value === "boolean") foam.value = value ? 1 : 0;
      if (typeof value !== "number") return;
      if (id === "sun") sunDirection(value, sun.value);
      if (id === "height") state.height = value;
      if (id === "wavelength") state.wavelength = value;
      if (id === "height" || id === "wavelength") setWaves();
    },
    dispose: () => orbit.dispose(),
  };
}

export function mountOcean(host: HTMLElement, init: LabSceneInit): Promise<LabScene> {
  return mountStudy(
    host,
    init,
    { fov: 45, far: 1200, bloom: { strength: 0.55, radius: 0.5 }, vignette: 0.35 },
    ocean,
  );
}
