/**
 * The lab family's shared package (DESIGN.md → Extension families): its view
 * key and the studies it switches between, and the declaration and shared
 * plugin both hosts load. The studies themselves, and the scene kit they
 * stand on, are the page's.
 */
export { LAB_SCENE_IDS, LabParams, LabView, type LabSceneId } from "./view.ts";
export { labExtension, labPlugin } from "./extension.ts";
