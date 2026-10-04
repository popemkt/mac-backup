/**
 * `@kb/scene`: the scene kit every real-time 3D view stands on (DESIGN-UI.md
 * → The lab): the lab's studies, the canvas's 3D projection and the core
 * `graph.force3d` renderer alike, so no view owns a copy. Mechanism only: it
 * reads tokens and timing from `@kb/ui-sdk` and knows no surface.
 *
 * This package is the part that touches no GPU: the scene host every view's
 * React host mounts through, the palette roles, and the shading and placement
 * arithmetic. The stage, its post chain, rig and starfield are three by
 * another name and live in `@kb/scene-gpu`, which only a lazily loaded scene
 * imports, so a 3D host that mounts a scene does not carry three itself.
 */
export type { SceneBackend } from "./backend";
export { attachScene, type SceneHandle } from "./host";
export { readScenePalette, type ScenePalette } from "./palette";
export { BLOOM_THRESHOLD, NUMBER_OPS, type Rgb, type ShadeOps } from "./shade-ops";
export { scatterPlace, sphereDirection, unitHash, type SpherePlace } from "./sphere";
