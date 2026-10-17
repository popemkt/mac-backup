import { describe, expect, test } from "vitest";
import { CanvasView } from "@kb/canvas";
import { provideRoute } from "@kb/ui-sdk";
import { canvasPath, matchCanvas, matchCanvasList } from "./routes";

describe("canvas routes", () => {
  test("a canvas's path reads back as the canvas, whatever its id holds", () => {
    for (const id of ["01M5", "n.board", "a b/c?d#e"]) {
      expect(matchCanvas(canvasPath({ id }))).toEqual({ id });
    }
  });

  test("an item on a canvas reads back as both", () => {
    for (const item of ["i1", "a/b c"]) {
      expect(matchCanvas(canvasPath({ id: "n.board", item }))).toEqual({ id: "n.board", item });
    }
    expect(matchCanvas("/canvas/a/b/c")).toBeNull();
  });

  test("the list's path is not a canvas's", () => {
    expect(matchCanvasList("/canvas")).toEqual({});
    expect(matchCanvas("/canvas")).toBeNull();
    expect(matchCanvasList(canvasPath({ id: "x" }))).toBeNull();
  });

  test("a path with a malformed escape is no canvas, and resolving it does not throw", () => {
    const route = provideRoute({
      view: CanvasView,
      match: matchCanvas,
      frame: () => "fixed",
      pendingTitle: () => "",
    });
    expect(route.value.resolve("/canvas/%E0%A4%A")).toBeNull();
    expect(route.value.resolve("/canvas/n.board/%E0%A4%A")).toBeNull();
    expect(route.value.resolve(canvasPath({ id: "n.board" }))?.params).toEqual({ id: "n.board" });
  });
});
