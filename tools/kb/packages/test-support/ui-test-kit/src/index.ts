/**
 * `@kb/ui-test-kit`: what a browser package's test builds its world from
 * (DESIGN.md → Workspace shape), as `@kb/test-kit` is for the rest: a
 * happy-dom window installed on the globals and taken off again, and the
 * stand-ins for the GPU and the 2D canvas that happy-dom lacks. `@kb/ui`'s
 * tests and each family's UI half's tests import it, so a stand-in has one
 * home whichever package the code under test sits in.
 */
export { installDomGlobals, type InstalledDom } from "./dom-globals";
export { FAKE_WEBGPU, fakeCanvasContexts, gpu, renders, type FakeRenderer } from "./fake-gpu";
