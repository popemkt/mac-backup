/**
 * Sky: a sun, a moon it lights, and the graph's nodes as stars standing in
 * the space round them — a volume to fly through, not a painted dome.
 *
 * This study reads the graph (it may; the lab does not require it): every
 * node is a star, placed by its lens cluster so siblings gather into a
 * constellation (`layout.ts`), and the few most recently updated nodes are
 * the glints. Hovering a star names its node and draws its edges as faint
 * constellation lines; clicking opens it. Three layers of dust at depth, and
 * the nebula at infinity, are decoration, never data.
 *
 * Light: the sun is the only light. The moon's shading is the sun's
 * direction from each point of it (`shaders.ts`), so its terminator and phase
 * follow wherever the two stand; drag either and the phase turns. The night
 * side keeps a faint earthshine (a slider).
 *
 * Motion: a drag on empty sky orbits the camera round its target, and it
 * coasts on release (M3); the wheel or a pinch dollies (`kit/orbit`). A drag
 * that lands on a star, the sun or the moon moves that instead, at its own
 * depth. The one ambient motion is a slow constant drift of the orbit
 * (M1, M4). The theme picks what the camera flies to — the sun rules the
 * light theme, the moon the dark — and by day the moon's unlit side lets the
 * sky through, as a daytime moon does (P5). Arriving, the stars kindle in a
 * seeded order and the bodies brighten in.
 */
import { Group, Vector3, type Object3D } from "three/webgpu";
import { float, uniform, vec3 } from "three/tsl";
import type { LabControlValue, LabSceneInit, LabScene } from "@/components/lab/kit/contract";
import type { LabGraph } from "@/components/lab/lab-graph";
import { OrbitControl } from "@/components/lab/kit/orbit";
import { Entrance } from "@/components/lab/kit/entrance";
import type { SceneStage } from "@/scene/gpu/stage";
import { mountStudy, type StudyContext, type StudyParts } from "@/components/lab/kit/study";
import { approachRate } from "@/lib/timing";
import { starfield } from "@/scene/gpu/starfield";
import { corona, moon, nebula, sun } from "@/components/lab/sky/shaders";
import { NodeStars, stepConstellation } from "@/components/lab/sky/stars";
import { SkyHands } from "@/components/lab/sky/hands";

/** Where the bodies stand, and how big they are (world units). */
const MOON_AT = new Vector3(0, 0, 0);
const MOON_RADIUS = 1.5;
const SUN_AT = new Vector3(-17, 3.5, -11);
const SUN_RADIUS = 3.4;
/** How far the camera stands from what it looks at, by theme. */
const NIGHT_DISTANCE = 14;
const DAY_DISTANCE = 30;
/** How far toward the moon the day view looks from the sun, so both are in frame. */
const DAY_LEAN = 0.4;
/** The orbit's own slow turn (rad/s): about 17 minutes a revolution (M4). */
const DRIFT = 0.006;
/** Dust at three depths, so it too slides against itself as the camera moves. */
const DUST = [
  { seed: "dust-near", count: 700, radius: 190, size: 0.9, opacity: 0.35 },
  { seed: "dust-mid", count: 1100, radius: 270, size: 1.1, opacity: 0.3 },
  { seed: "dust-far", count: 1600, radius: 360, size: 1.3, opacity: 0.26 },
] as const;

function uniforms(dark: boolean) {
  return {
    time: uniform(0),
    twinkle: uniform(1),
    hover: uniform(-1),
    spikes: uniform(1),
    /** The constellation lines' opacity, eased in when a star is hovered. */
    lines: uniform(0),
    nebula: uniform(0.32),
    earthshine: uniform(0.05),
    day: uniform(dark ? 0 : 1),
    sun: uniform(SUN_AT.clone()),
  };
}
type SkyUniforms = ReturnType<typeof uniforms>;

/** What the camera looks at under a theme: the moon by night, the sun (leaning to the moon) by day. */
function focus(dark: boolean, sunAt: Vector3, moonAt: Vector3, out: Vector3): Vector3 {
  return dark ? out.copy(moonAt) : out.copy(sunAt).lerp(moonAt, DAY_LEAN);
}

/** The sun (sphere and corona) and the moon, placed and scaled. */
function bodies(stage: SceneStage, u: SkyUniforms, entrance: Entrance) {
  const time = float(u.time);
  const sunMesh = sun(stage.colors, time, entrance.arrival(float(0)));
  const halo = corona(stage.colors, time, entrance.arrival(float(0)));
  const moonMesh = moon(stage.colors, {
    sun: vec3(u.sun),
    earthshine: float(u.earthshine),
    day: float(u.day),
    arrival: entrance.arrival(float(0.35)),
  });
  sunMesh.scale.setScalar(SUN_RADIUS);
  halo.scale.setScalar(SUN_RADIUS * 6);
  moonMesh.scale.setScalar(MOON_RADIUS);
  moonMesh.position.copy(MOON_AT);
  const sunGroup = new Group();
  sunGroup.add(sunMesh, halo);
  sunGroup.position.copy(SUN_AT);
  return {
    sun: sunGroup,
    moon: moonMesh,
    /** Stand the sun at `to`: the moon's light follows. */
    moveSun: (to: Vector3) => {
      sunGroup.position.copy(to);
      u.sun.value.copy(to);
    },
  };
}

function sky(stage: SceneStage, init: LabSceneInit, context: StudyContext): StudyParts {
  const u = uniforms(init.dark);
  const entrance = new Entrance(init.timing);
  const { colors } = stage;
  stage.scene.add(
    nebula(colors, {
      amount: float(u.nebula),
      sun: vec3(u.sun),
      day: float(u.day),
      arrival: entrance.arrival(float(0)),
    }),
    ...DUST.map((layer) => starfield(colors, layer).sprite),
  );
  const body = bodies(stage, u, entrance);
  stage.scene.add(body.sun, body.moon);
  const starUniforms = {
    time: float(u.time),
    twinkle: float(u.twinkle),
    hover: float(u.hover),
    spikes: float(u.spikes),
    lines: float(u.lines),
  };
  let stars = new NodeStars(colors, starUniforms, init.graph, entrance);
  stage.scene.add(stars.sprite, stars.lines);

  let dark = init.dark;
  const aim = focus(dark, SUN_AT, MOON_AT, new Vector3());
  const hands = new SkyHands(
    { host: context.host, canvas: stage.renderer.domElement, camera: stage.camera },
    { ...body, sunRadius: SUN_RADIUS, moonRadius: MOON_RADIUS },
    () => stars,
    init,
    (index) => {
      u.hover.value = index;
      // A new constellation fades in from nothing; a let-go one fades out from where it is.
      if (index >= 0) u.lines.value = 0;
    },
  );
  const orbit = new OrbitControl(
    context.host,
    { perPixel: 0.0045, pitch: [-1.25, 1.25], distance: [4, 70] },
    { yaw: 0.42, pitch: 0.12, distance: dark ? NIGHT_DISTANCE : DAY_DISTANCE, target: aim },
    init.timing,
    { onChange: () => stage.invalidate(), grab: (x, y) => hands.grab(x, y) },
  );
  const lineRate = approachRate(init.timing.reveal);

  return {
    frame: (dt, elapsed) => {
      const reduced = context.reduced();
      u.time.value = elapsed;
      u.twinkle.value = reduced ? 0 : 1;
      entrance.step(dt, reduced);
      orbit.frame(dt, reduced, stage.camera, DRIFT);
      stage.camera.updateMatrixWorld();
      u.lines.value = stepConstellation(
        { hover: hands, stars },
        {
          opacity: u.lines.value,
          rate: lineRate,
          dt,
          reduced,
          holding: orbit.control.dragging || orbit.control.held !== null,
        },
      );
    },
    setControl: (id, value: LabControlValue) => {
      if (id === "spikes" && typeof value === "number") u.spikes.value = value;
      if (id === "nebula" && typeof value === "number") u.nebula.value = value;
      if (id === "earthshine" && typeof value === "number") u.earthshine.value = value;
      if (id === "dither" && typeof value === "boolean") stage.knobs.dither.value = value ? 1 : 0;
    },
    setPalette: (_palette, isDark) => {
      u.twinkle.value = context.reduced() ? 0 : 1;
      u.day.value = isDark ? 0 : 1;
      stage.setBloom(isDark ? 0.85 : 0.45);
      if (isDark === dark) return;
      dark = isDark;
      orbit.flyTo(
        focus(dark, body.sun.position, body.moon.position, aim),
        dark ? NIGHT_DISTANCE : DAY_DISTANCE,
      );
    },
    setGraph: (next: LabGraph) => {
      const old: Object3D[] = [stars.sprite, stars.lines];
      stage.scene.remove(...old);
      for (const m of [stars.sprite.material, stars.lines.material].flat()) m.dispose();
      stars.dispose();
      stars = new NodeStars(colors, starUniforms, next, entrance);
      stage.scene.add(stars.sprite, stars.lines);
      hands.reset();
    },
    dispose: () => {
      hands.dispose();
      orbit.dispose();
      stars.dispose();
    },
  };
}

export function mountSky(host: HTMLElement, init: LabSceneInit): Promise<LabScene> {
  return mountStudy(
    host,
    init,
    { fov: 50, far: 1200, bloom: { strength: 0.85, radius: 0.55 }, vignette: 0.3 },
    sky,
  );
}
