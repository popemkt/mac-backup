import { describe, expect, test } from "vitest";
import { canvasPath, matchCanvas, matchCanvasList } from "./routes";

describe("canvas routes", () => {
  test("a canvas's path reads back as the canvas, whatever its id holds", () => {
    for (const id of ["01M5", "n.board", "a b/c?d#e"]) {
      expect(matchCanvas(canvasPath({ id }))).toEqual({ id });
    }
  });

  test("the list's path is not a canvas's", () => {
    expect(matchCanvasList("/canvas")).toEqual({});
    expect(matchCanvas("/canvas")).toBeNull();
    expect(matchCanvasList(canvasPath({ id: "x" }))).toBeNull();
  });
});
