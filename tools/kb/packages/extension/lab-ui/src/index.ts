/**
 * `@kb/lab-ui`: the lab family's browser half (DESIGN.md → Extension
 * families; DESIGN-UI.md → The lab): the lab's page, its sidebar section and
 * its studies, each a real-time 3D scene on the scene kit, loaded in a chunk
 * of its own. The page loads the entry, `labUiPlugin`, as an import() chunk,
 * only while the server reports the lab switched on.
 *
 * Also named here, for `@kb/ui`'s tests that hold the lab to the page: the
 * registered studies and the scene interface they implement (the scene
 * contract runs over them), and Embers' heat arithmetic (checked against
 * every design system's accent).
 */
export { labUiPlugin } from "./plugin";
export { LAB_STUDIES } from "./studies";
export type { LabScene, LabSceneInit } from "./kit/contract";
export {
  HEAT_GAIN,
  RestCeiling,
  heatAlbedo,
  peakEmissive,
  peakShown,
  restCeiling,
  type Rgb,
} from "./embers/heat";
