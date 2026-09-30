/**
 * The 3D canvas on three's WebGL2 backend. WebGPU is hidden from the page
 * before any of its scripts run, so three's renderer finds no `navigator.gpu`
 * and falls back, as it does in a browser without WebGPU; the scene must
 * still draw the round trip. A machine with a WebGPU adapter never takes this
 * path otherwise.
 */
import { test } from "./harness-test.ts";
import { crossIntoDepth } from "./canvas3d-scenario.ts";

test("a canvas crosses into depth and back on the WebGL2 backend", async ({
  page,
  request,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined });
  });
  await crossIntoDepth({ page, request, backend: "WebGL2" }, testInfo);
});
