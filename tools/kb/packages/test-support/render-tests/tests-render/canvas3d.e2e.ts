import { test } from "./harness-test.ts";
import { crossIntoDepth } from "./canvas3d-scenario.ts";

test("a canvas crosses into depth and back through one camera", async ({
  page,
  request,
  gpu,
}, testInfo) => {
  await crossIntoDepth({ page, request, backend: gpu.backend }, testInfo);
});
