/**
 * The canvas family owns its vocabulary: its declaration seeds the `#canvas`
 * tag and the field it templates under the ids core once seeded, lists the
 * canvas list and the canvas page, and its shared plugin, which both hosts
 * load, contributes those views with no text of their own.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Result } from "effect";
import { BUNDLED_DECLARATIONS, bundledSeed } from "@kb/bundled";
import { ViewKeyPoint } from "@kb/contracts";
import { SYSTEM_IDS } from "@kb/model";
import { makeKernel } from "@kb/plugin";
import { issueText, paramsFrom, viewNodeFor } from "@kb/views";
import { CANVAS_IDS, CanvasListView, CanvasView, canvasExtension, canvasPlugin } from "@kb/canvas";

const AT = "2026-01-01T00:00:00.000Z";

/** The views the shared plugin contributes, as a host's kernel holds them. */
function contributed() {
  return Effect.runSync(
    Effect.gen(function* () {
      const kernel = makeKernel();
      yield* kernel.load(canvasPlugin());
      const views = kernel.contributions(ViewKeyPoint).map(({ id, value }) => ({ id, value }));
      yield* kernel.shutdown;
      return views;
    }),
  );
}

describe("canvas family", () => {
  test("its ids keep the spelling core seeded them under", () => {
    expect(CANVAS_IDS).toEqual({ canvasTag: "sys.tag.canvas", canvasField: "sys.f.canvas" });
    expect(Object.values(SYSTEM_IDS)).not.toContain(CANVAS_IDS.canvasTag);
    expect(Object.values(SYSTEM_IDS)).not.toContain(CANVAS_IDS.canvasField);
  });

  test("its seed is the #canvas tag templating the field its document lives in", () => {
    const seed = canvasExtension.seed?.(AT) ?? [];
    expect(seed.map((node) => node.id)).toEqual([CANVAS_IDS.canvasField, CANVAS_IDS.canvasTag]);
    const tag = seed.find((node) => node.id === CANVAS_IDS.canvasTag);
    expect(tag?.props[SYSTEM_IDS.typeField]).toEqual([{ t: "ref", v: SYSTEM_IDS.tag }]);
    expect(tag?.props[SYSTEM_IDS.fieldsField]).toEqual([{ t: "ref", v: CANVAS_IDS.canvasField }]);
  });

  test("the bundled fold seeds its nodes and derives its views' options", () => {
    expect(BUNDLED_DECLARATIONS).toContain(canvasExtension);
    const ids = new Set(bundledSeed(AT).map((node) => node.id));
    for (const id of [
      CANVAS_IDS.canvasTag,
      CANVAS_IDS.canvasField,
      CanvasListView.option,
      CanvasView.option,
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  test("its plugin takes the declaration's name and contributes its views with no text", () => {
    expect(canvasPlugin().name).toBe(canvasExtension.name);
    expect(canvasExtension.views?.map((view) => view.key)).toEqual([CanvasListView, CanvasView]);
    const views = contributed();
    expect(views.map((view) => view.id)).toEqual([CanvasListView.id, CanvasView.id]);
    expect(views.map((view) => view.value.text)).toEqual([undefined, undefined]);
  });

  test("one canvas is named by its node's id", () => {
    expect(CanvasView.id).toBe("canvas.page");
    expect(CanvasListView.id).toBe("canvas.list");
    expect(Result.getOrNull(paramsFrom(CanvasView, { id: "n.canvas" }))).toEqual({
      id: "n.canvas",
    });
    expect(Result.isFailure(paramsFrom(CanvasView, {}))).toBe(true);
  });

  test("its params come from the route, so a view node cannot hold them", () => {
    const proposed = viewNodeFor(CanvasView, { id: "n.canvas" }, null);
    expect(Result.isFailure(proposed) ? proposed.failure.map(issueText) : []).toEqual([
      "id: a view node of canvas.page cannot hold this setting; it reads back as: Missing key",
    ]);
  });
});
