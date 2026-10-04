/**
 * `@kb/ui-test-kit`: what a browser package's test builds its world from
 * (DESIGN.md → Workspace shape), as `@kb/test-kit` is for the rest: a
 * happy-dom window installed on the globals and taken off again, the
 * stand-ins for the GPU and the 2D canvas that happy-dom lacks, the scene
 * contract each package runs over the scenes it registers, and a
 * `BrowserHost` a UI half's tests hold the half to. `@kb/ui`'s
 * tests and each family's UI half's tests import it, so a stand-in has one
 * home whichever package the code under test sits in.
 */
export { installDomGlobals, type InstalledDom } from "./dom-globals";
export { FAKE_WEBGPU, fakeCanvasContexts, gpu, renders, type FakeRenderer } from "./fake-gpu";
export { sceneContract, type SceneMount } from "./scene-contract";
export {
  testBrowserHost,
  testHostPlugin,
  type ActiveNode,
  type HeldReport,
  type TestBrowserHost,
} from "./browser-host";
