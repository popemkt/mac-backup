/**
 * The scene kit's light rig and material set (Lab principles L2, L5).
 *
 * Light: a named three-point rig. The key is a warm directional light (it
 * carries the accent) that may cast soft shadows; the fill is a hemisphere
 * light from the hue family above and the ground below, so shadows are
 * coloured rather than grey; the rim is a cool light from behind that draws
 * silhouettes out of the background.
 *
 * Materials: four finishes with fixed roughness/metalness, all tinted from
 * the palette — no scene ships three's default grey.
 */
import {
  CanvasTexture,
  Color,
  DirectionalLight,
  HemisphereLight,
  MeshMatcapNodeMaterial,
  MeshStandardNodeMaterial,
  SRGBColorSpace,
  type Object3D,
} from "three/webgpu";
import type { ScenePalette } from "@/scene/palette";

/** Physically plausible intensities for the rig, under AgX. */
const KEY = 3.2;
const FILL = 1.5;
const RIM = 2.2;

export interface LightRig {
  readonly key: DirectionalLight;
  readonly fill: HemisphereLight;
  readonly rim: DirectionalLight;
  readonly lights: readonly Object3D[];
  /** Re-tint from a palette (a theme change). */
  setPalette(palette: ScenePalette): void;
  /** Swing the key round the subject, radians from front-left. */
  setKeyAngle(angle: number, height: number, distance: number): void;
}

/** The key casts soft shadows exactly when the stage it lights has them (`StageOptions.shadows`). */
export function createRig(stage: { readonly shadows: boolean }, palette: ScenePalette): LightRig {
  const key = new DirectionalLight(undefined, KEY);
  const fill = new HemisphereLight(undefined, undefined, FILL);
  const rim = new DirectionalLight(undefined, RIM);
  rim.position.set(-3, 4, -6);
  if (stage.shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 6;
    key.shadow.blurSamples = 16;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    const box = key.shadow.camera;
    box.left = -6;
    box.right = 6;
    box.top = 6;
    box.bottom = -6;
    box.near = 0.5;
    box.far = 30;
  }
  const scratch = new Color();
  const rig: LightRig = {
    key,
    fill,
    rim,
    lights: [key, fill, rim],
    setPalette: (p) => {
      key.color.setRGB(1, 1, 1).lerp(scratch.set(p.accent), 0.28);
      fill.color.set(p.hue).lerp(scratch.set(p.ink), 0.2);
      fill.groundColor.set(p.ground);
      rim.color.set(p.ink).lerp(scratch.set(p.hue), 0.35);
    },
    setKeyAngle: (angle, height, distance) => {
      key.position.set(Math.cos(angle) * distance, height, Math.sin(angle) * distance);
    },
  };
  rig.setPalette(palette);
  rig.setKeyAngle(Math.PI * 0.8, 7, 6);
  return rig;
}

export type Finish = "matte" | "satin" | "glaze" | "metal";

/** The one table of finishes (L5): roughness and metalness never vary by scene. */
const FINISHES: Record<Finish, { readonly roughness: number; readonly metalness: number }> = {
  matte: { roughness: 0.9, metalness: 0 },
  satin: { roughness: 0.55, metalness: 0 },
  glaze: { roughness: 0.2, metalness: 0 },
  metal: { roughness: 0.32, metalness: 1 },
};

/** A finish; its colour is the given one, or the study's own `colorNode`. */
export function finishMaterial(finish: Finish, color?: string): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial(FINISHES[finish]);
  if (color !== undefined) material.color.set(color);
  return material;
}

/**
 * A matcap painted from the palette: the lit sphere a matcap material looks
 * up by normal. Light from the upper left in the accent, falling to the hue,
 * with a rim of ink — the same rig, baked.
 */
export function paletteMatcap(palette: ScenePalette): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const body = ctx.createRadialGradient(
      size * 0.36,
      size * 0.3,
      size * 0.04,
      size / 2,
      size / 2,
      size / 2,
    );
    body.addColorStop(0, palette.ground);
    body.addColorStop(0.35, palette.accent);
    body.addColorStop(0.8, palette.hue);
    body.addColorStop(1, palette.ink);
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function matcapMaterial(texture: CanvasTexture): MeshMatcapNodeMaterial {
  return new MeshMatcapNodeMaterial({ matcap: texture });
}
