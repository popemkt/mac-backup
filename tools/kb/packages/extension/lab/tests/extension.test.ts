/**
 * The lab family owns its vocabulary: its declaration lists the lab page and
 * seeds no node of its own, the bundled fold derives the page's option under
 * the id core once seeded, and its shared plugin, which both hosts load,
 * contributes the page with no text of its own.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Result } from "effect";
import { BUNDLED_DECLARATIONS, bundledSeed } from "@kb/bundled";
import { ViewKeyPoint } from "@kb/contracts";
import { makeKernel } from "@kb/plugin";
import { paramsFrom } from "@kb/views";
import { LAB_SCENE_IDS, LabView, labExtension, labPlugin } from "@kb/lab";

/** The views the shared plugin contributes, as a host's kernel holds them. */
function contributed() {
  return Effect.runSync(
    Effect.gen(function* () {
      const kernel = makeKernel();
      yield* kernel.load(labPlugin());
      const views = kernel.contributions(ViewKeyPoint).map(({ id, value }) => ({ id, value }));
      yield* kernel.shutdown;
      return views;
    }),
  );
}

describe("lab family", () => {
  test("its declaration lists the lab page and seeds no node of its own", () => {
    expect(labExtension.views?.map((view) => view.key)).toEqual([LabView]);
    expect(labExtension.seed).toBeUndefined();
  });

  test("the bundled fold derives the page's option under its frozen id", () => {
    expect(LabView.id).toBe("lab.page");
    expect(LabView.option).toBe("sys.view.lab.page");
    expect(BUNDLED_DECLARATIONS).toContain(labExtension);
    const option = bundledSeed("2026-01-01T00:00:00.000Z").find(
      (node) => node.id === LabView.option,
    );
    expect(option?.text).toBe("Lab");
  });

  test("its plugin takes the declaration's name and contributes the page with no text", () => {
    expect(labPlugin().name).toBe(labExtension.name);
    const views = contributed();
    expect(views.map((view) => view.id)).toEqual([LabView.id]);
    expect(views.map((view) => view.value.text)).toEqual([undefined]);
  });

  test("its params are one of the studies, the first being /lab's", () => {
    expect(LAB_SCENE_IDS[0]).toBe("embers");
    for (const scene of LAB_SCENE_IDS) {
      expect(Result.getOrNull(paramsFrom(LabView, { scene }))).toEqual({ scene });
    }
    expect(Result.isFailure(paramsFrom(LabView, { scene: "nowhere" }))).toBe(true);
  });
});
