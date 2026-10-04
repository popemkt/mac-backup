/**
 * `@kb/scene-gpu`: the scene kit's GPU half (DESIGN-UI.md → The lab): the
 * stage every real-time 3D view stands on — three's renderer, one post chain,
 * one frame loop and one reveal — with its rig, starfield, screen geometry,
 * pointer field and node helpers. It is three by another name, so the lazy
 * fence (`UI_LAZY_ONLY`) follows it from the page's entry: only a view's own
 * lazily loaded scene imports it. The host and palette it draws with are
 * `@kb/scene`.
 */
export { disposeGraph } from "./dispose";
export { PointerField } from "./pointer";
export { createRig, finishMaterial, matcapMaterial, paletteMatcap, type Finish } from "./rig";
export { onFacingPlane, pixelsPerUnit, toScreen, type ScreenPoint } from "./screen";
export {
  mountScene,
  type PaletteUniforms,
  type SceneStage,
  type SceneToneMapping,
  type StageOptions,
} from "./stage";
export { starfield } from "./starfield";
export { NODE_OPS, colorUniform, easeNode, linearFromSrgb, minInt, type TslNode } from "./tsl";
