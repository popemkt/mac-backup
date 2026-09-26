/**
 * The one `test` every render spec imports: Playwright's, plus a fresh
 * fixture store per test (`harness`) that `baseURL` points at, so
 * `page.goto("/graph")` always lands on a store no earlier test has written
 * to, and the GPU facts a spec may depend on (`gpu`).
 */
import { test as base, expect, type Locator } from "playwright/test";
import { startHarness } from "./harness-server.ts";

export { expect };

type Box = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

/**
 * An element's box once it has stopped moving: two samples in a row that
 * agree. Waiting on the animations alone races the click that starts them —
 * a motion React has not committed yet has no animation to wait on.
 */
export async function settledBox(locator: Locator): Promise<Box> {
  const last: { box: Box | null; key: string } = { box: null, key: "" };
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        const key = JSON.stringify(box);
        const still = box !== null && key === last.key;
        last.box = box;
        last.key = key;
        return still;
      },
      { intervals: [100, 250] },
    )
    .toBe(true);
  if (last.box === null) throw new Error("the element has no box");
  return last.box;
}

export interface GpuFacts {
  /** Chromium handed out a WebGPU adapter on this machine. */
  readonly webgpu: boolean;
  /**
   * The backend the scene kit must report here, spelled the way the UI
   * reports it (`SceneBackend` in `ui/src/scene/backend.ts`, which a
   * test-support package cannot import). With an adapter it is WebGPU, so a
   * silent fall back to WebGL2 is red, not a pass.
   */
  readonly backend: "WebGPU" | "WebGL2";
}

export const test = base.extend<{
  harness: { url: string };
  gpu: GpuFacts;
}>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads fixture deps from the destructuring pattern
  harness: async ({}, provide) => {
    const harness = await startHarness();
    try {
      await provide({ url: harness.url });
    } finally {
      await harness.stop();
    }
  },
  baseURL: async ({ harness }, provide) => {
    await provide(harness.url);
  },
  gpu: async ({ context, harness }, provide) => {
    // `navigator.gpu` exists only in a secure context; the harness origin
    // (127.0.0.1) is one, about:blank is not.
    const probe = await context.newPage();
    await probe.goto(`${harness.url}/api/graph`);
    const webgpu = await probe.evaluate(async () => {
      // Typed as always present; a browser without WebGPU has no `gpu` at all.
      const gpu = (navigator as { gpu?: GPU }).gpu;
      return gpu !== undefined && (await gpu.requestAdapter()) !== null;
    });
    await probe.close();
    await provide({ webgpu, backend: webgpu ? "WebGPU" : "WebGL2" });
  },
});
