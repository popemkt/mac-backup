/**
 * Embers' looks: four ways to shade the same simulation, switched on the
 * info card. Every look takes the same inputs — where a sphere is, how big,
 * its contact heat, its resting glow and the frame's cap on it — and every
 * look lights heat through the one curve (`heat.ts`), so the bloom cap holds
 * whichever is shown: a look may only ever *lower* the shown temperature or
 * multiply the emission by at most 1, never raise either (L2).
 *
 * - **glow**: the kit's satin finish under the heat ramp — the PBR-ish ember.
 * - **toon**: cel shading. The rig's light falls into four flat bands
 *   (`MeshToonNodeMaterial` over a four-step ramp), heat is quantised down to
 *   the same count of steps (a pop's flash stays whole), and an inverted hull
 *   draws an ink outline.
 * - **molten**: a basalt crust over lava. Ridged noise (the zero set of a
 *   smooth field), bent by a slower one
 *   and flowing upward, cracks the crust; the cracks glow at rest (up to
 *   the cap) and a sphere hot from contact melts through.
 * - **film**: thin-film interference, as on a soap bubble. A film of varying
 *   thickness reflects each wavelength by the phase of its round trip,
 *   `cos(4π·n·d·cosθt / λ)`, so the colour turns with the viewing angle.
 */
import {
  BackSide,
  DataTexture,
  Mesh,
  MeshBasicNodeMaterial,
  MeshToonNodeMaterial,
  NearestFilter,
  RedFormat,
  type BufferGeometry,
  type Material,
} from "three/webgpu";
import {
  cos,
  dot,
  float,
  hash,
  instanceIndex,
  mix,
  mx_noise_float,
  normalView,
  positionGeometry,
  positionLocal,
  positionViewDirection,
  select,
  smoothstep,
  sqrt,
  vec3,
} from "three/tsl";
import { finishMaterial } from "@/scene/gpu/rig";
import type { PaletteUniforms, SceneStage } from "@/scene/gpu/stage";
import { NODE_OPS, type TslNode } from "@/scene/gpu/tsl";
import { EMBER_TINT, displayTemperature, heatEmissive } from "@/components/lab/embers/heat";

const EMBER_LOOKS = ["glow", "toon", "molten", "film"] as const;
export type EmberLook = (typeof EMBER_LOOKS)[number];

export function isEmberLook(value: unknown): value is EmberLook {
  return EMBER_LOOKS.some((look) => look === value);
}

/** What every look shades from: the simulation's per-sphere values, as nodes. */
export interface LookInputs {
  readonly colors: PaletteUniforms;
  /** The sphere's centre and radius, world units. */
  readonly place: TslNode;
  readonly radius: TslNode;
  /** Contact heat (and a pop's flash), the resting glow, and this frame's cap on the rest. */
  readonly contact: TslNode;
  readonly rest: TslNode;
  readonly ceiling: TslNode;
  readonly gain: TslNode;
  /** 1 on a dark theme, 0 on a light one. */
  readonly dark: TslNode;
  readonly time: TslNode;
}

/** A look's draw: the sphere mesh, and what else it adds (the toon outline). */
export interface LookParts {
  readonly meshes: readonly Mesh[];
  /** Resources no material or geometry owns (the toon ramp). */
  readonly dispose: () => void;
}

const FLASH = 1.6;
const BANDS = 4;
/** The outline's width, world units, whatever the sphere's size. */
const INK = 0.016;

function shown(i: LookInputs, rest: TslNode = i.rest): TslNode {
  return displayTemperature(NODE_OPS, i.contact, rest, i.ceiling).min(FLASH);
}

function emissive(i: LookInputs, t: TslNode): TslNode {
  return heatEmissive(NODE_OPS, vec3(i.colors.accent), t, i.gain);
}

function instanced(geometry: BufferGeometry, material: Material, count: number): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.count = count;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * A seeded offset per sphere, so no two share a pattern. Patterns read
 * `positionGeometry`, the unit sphere, not the placed position.
 */
function seed(): TslNode {
  const i = instanceIndex.toFloat();
  return vec3(hash(i), hash(i.add(17.3)), hash(i.add(41.9))).mul(19);
}

function glow(i: LookInputs, geometry: BufferGeometry, count: number): LookParts {
  const ember = i.colors.accent.mul(vec3(...EMBER_TINT));
  const material = finishMaterial("satin");
  material.positionNode = positionLocal.mul(i.radius).add(i.place);
  material.colorNode = mix(ember.mul(0.3), i.colors.hue.mul(0.2), 0.3);
  material.emissiveNode = emissive(i, shown(i));
  return { meshes: [instanced(geometry, material, count)], dispose: () => {} };
}

/** The four tones the toon light falls into, darkest first. */
function toonRamp(): DataTexture {
  const tones = new Uint8Array([46, 110, 180, 255]);
  const ramp = new DataTexture(tones, BANDS, 1, RedFormat);
  ramp.minFilter = NearestFilter;
  ramp.magFilter = NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

function toon(i: LookInputs, geometry: BufferGeometry, count: number): LookParts {
  const ramp = toonRamp();
  const material = new MeshToonNodeMaterial({ gradientMap: ramp });
  const ember = i.colors.accent.mul(vec3(...EMBER_TINT));
  material.positionNode = positionLocal.mul(i.radius).add(i.place);
  material.colorNode = mix(ember.mul(0.55), i.colors.hue.mul(0.45), 0.4);
  // Quantised down: a band never shows hotter than the heat it stands for.
  const t = shown(i);
  const banded = select(t.greaterThan(1), t, t.mul(BANDS).floor().div(BANDS));
  // @types/three declares `emissiveNode` on the standard family only; every
  // NodeMaterial reads it (`setupLighting`), the toon one included.
  Object.assign(material, { emissiveNode: emissive(i, banded) });
  const ink = new MeshBasicNodeMaterial({ side: BackSide });
  ink.positionNode = positionLocal.mul(i.radius.add(INK)).add(i.place);
  // Dark on both grounds: the ink on a light one, the deep edge on a dark one.
  ink.colorNode = mix(i.colors.ink, i.colors.edge.mul(0.35), i.dark);
  return {
    meshes: [instanced(geometry, material, count), instanced(geometry, ink, count)],
    dispose: () => ramp.dispose(),
  };
}

function molten(i: LookInputs, geometry: BufferGeometry, count: number): LookParts {
  const flow = positionGeometry
    .mul(1.3)
    .add(seed())
    .add(vec3(0, i.time.mul(0.22), 0));
  const bent = flow.add(mx_noise_float(flow.mul(0.8)).mul(0.6));
  // Ridged noise: the zero set of a smooth field is a network of veins.
  const vein = mx_noise_float(bent).toVar();
  const crack = float(1).sub(smoothstep(0, 0.12, vein.abs()));
  // The cracks hold a hotter rest — still under the cap, which `shown` applies.
  const t = shown(i, i.rest.mul(0.7).add(crack.mul(0.55)));
  const melt = smoothstep(0.55, 1, i.contact);
  const reveal = mix(mix(float(0.08), float(1), crack), float(1), melt);
  const material = finishMaterial("matte");
  material.positionNode = positionLocal.mul(i.radius).add(i.place);
  const ember = i.colors.accent.mul(vec3(...EMBER_TINT));
  material.colorNode = mix(ember.mul(0.07), i.colors.hue.mul(0.06), 0.4).mul(
    // The crust's roughness reuses the vein field: a third noise cost a frame.
    vein.mul(0.6).add(0.85),
  );
  material.emissiveNode = emissive(i, t).mul(reveal);
  return { meshes: [instanced(geometry, material, count)], dispose: () => {} };
}

/** Wavelengths the film is sampled at, nm: red, green, blue. */
const LAMBDA = [650, 532, 450] as const;
const FILM_INDEX = 1.35;

function film(i: LookInputs, geometry: BufferGeometry, count: number): LookParts {
  const cosI = dot(normalView, positionViewDirection).clamp(0, 1);
  const cosT = sqrt(
    float(1).sub(
      float(1)
        .sub(cosI.mul(cosI))
        .div(FILM_INDEX * FILM_INDEX),
    ),
  );
  // Thickness in nm swirls slowly over the sphere, as a bubble's film drains.
  const swirl = mx_noise_float(
    positionGeometry
      .mul(1.6)
      .add(seed())
      .add(vec3(0, i.time.mul(0.05), 0)),
  );
  const thickness = swirl.mul(0.5).add(0.5).mul(420).add(260);
  const path = cosT.mul(thickness).mul(2 * FILM_INDEX);
  const band = (lambda: number) =>
    cos(path.mul((2 * Math.PI) / lambda))
      .mul(0.5)
      .add(0.5);
  const interference = vec3(band(LAMBDA[0]), band(LAMBDA[1]), band(LAMBDA[2]));
  const material = finishMaterial("glaze");
  material.positionNode = positionLocal.mul(i.radius).add(i.place);
  const base = mix(i.colors.ground, i.colors.hue, 0.35).mul(0.35);
  // Grazing angles reflect more: the film shows strongest at the rim.
  const facing = float(1).sub(cosI).pow(1.5).mul(0.6).add(0.4);
  material.colorNode = mix(base, interference.mul(0.85), facing);
  material.emissiveNode = emissive(i, shown(i));
  return { meshes: [instanced(geometry, material, count)], dispose: () => {} };
}

const BUILD: Record<
  EmberLook,
  (i: LookInputs, geometry: BufferGeometry, count: number) => LookParts
> = {
  glow,
  toon,
  molten,
  film,
};

/** A look that is no longer drawn: its materials and whatever else it owns. */
function release(parts: LookParts): void {
  for (const mesh of parts.meshes) {
    for (const material of [mesh.material].flat()) material.dispose();
  }
  parts.dispose();
}

/**
 * The look on show, and switching it: a new look's pipelines compile to one
 * side and it is swapped in whole (P2); the look asked for last wins, so a
 * slow compile never lands out of order, and one still compiling when the
 * study closes releases itself.
 */
export class LookSwitch {
  private shown: EmberLook;
  private wanted: EmberLook;
  private parts: LookParts;
  private readonly stage: SceneStage;
  private readonly build: (look: EmberLook) => LookParts;

  constructor(
    stage: SceneStage,
    inputs: LookInputs,
    geometry: BufferGeometry,
    count: number,
    first: EmberLook,
  ) {
    this.stage = stage;
    this.build = (look) => BUILD[look](inputs, geometry, count);
    this.shown = first;
    this.wanted = first;
    this.parts = this.build(first);
    stage.scene.add(...this.parts.meshes);
  }

  async show(next: EmberLook): Promise<void> {
    if (next === this.wanted) return;
    this.wanted = next;
    const built = this.build(next);
    const { renderer, camera, scene } = this.stage;
    const compiled = await Promise.all(
      built.meshes.map((mesh) => renderer.compileAsync(mesh, camera, scene)),
    ).then(
      () => true,
      // The stage went away mid-compile (the study was closed).
      () => false,
    );
    if (!compiled || this.wanted !== next) {
      release(built);
      return;
    }
    scene.remove(...this.parts.meshes);
    release(this.parts);
    this.parts = built;
    this.shown = next;
    scene.add(...built.meshes);
    this.stage.invalidate();
  }

  /** The stage disposes the meshes it holds; this releases what it does not reach. */
  dispose(): void {
    this.wanted = this.shown;
    this.parts.dispose();
  }
}
