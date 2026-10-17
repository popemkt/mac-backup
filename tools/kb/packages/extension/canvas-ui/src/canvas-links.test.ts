import { describe, expect, test } from "vitest";
import { CANVAS_IDS, canvasWorld } from "@kb/canvas";
import { SYSTEM_IDS } from "@kb/model";
import { nodePath } from "@kb/ui-sdk";
import { linkStep } from "./canvas-links";
import { canvasPath } from "./routes";

const canvas = (id: string) => ({
  id,
  text: id,
  children: [],
  props: { [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: CANVAS_IDS.canvasTag }] },
});
const world = canvasWorld([
  canvas("n.here"),
  canvas("n.page"),
  { id: "n.note", text: "note", props: {}, children: [] },
]);

describe("following a link", () => {
  test("a web address is opened outside kb", () => {
    expect(linkStep({ url: "https://tldraw.dev" }, "n.here", world)).toEqual({
      kind: "web",
      url: "https://tldraw.dev",
    });
  });

  test("a canvas is opened as a page, at the item named", () => {
    expect(linkStep({ node: "n.page" }, "n.here", world)).toEqual({
      kind: "path",
      path: canvasPath({ id: "n.page" }),
    });
    expect(linkStep({ node: "n.page", item: "i" }, "n.here", world)).toEqual({
      kind: "path",
      path: canvasPath({ id: "n.page", item: "i" }),
    });
  });

  test("any other node is opened as itself", () => {
    expect(linkStep({ node: "n.note" }, "n.here", world)).toEqual({
      kind: "path",
      path: nodePath("n.note"),
    });
  });

  test("an item on this canvas is shown here, however the link names the canvas", () => {
    expect(linkStep({ item: "i" }, "n.here", world)).toEqual({ kind: "here", item: "i" });
    expect(linkStep({ node: "n.here", item: "i" }, "n.here", world)).toEqual({
      kind: "here",
      item: "i",
    });
    expect(linkStep({ node: "n.here" }, "n.here", world)).toBeNull();
  });
});
