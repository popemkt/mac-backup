import { describe, expect, test } from "vitest";
import type { CanvasNode } from "@kb/canvas";
import type { OutlineNode } from "@kb/ui-sdk";
import { cardFaceOf, over, type CardLook } from "./canvas-card-face";
import { isPicture, type FacePicture } from "./canvas-face-pictures";

const look: CardLook = {
  face: "rgb(255, 255, 255)",
  ink: "rgb(0, 0, 0)",
  primary: "rgb(200, 100, 0)",
  danger: "rgb(200, 0, 0)",
  presets: {},
  font: "sans-serif",
  body: 14.5,
  ui: 13,
  label: 11,
  radius: 18,
  shapeRadius: 8,
};

const at = { x: 0, y: 0, width: 100, height: 50 };
/** No picture has loaded yet. */
const loading = (): FacePicture => ({ state: "loading" });

describe("a card's face", () => {
  test("a note card shows its node's text, refs as labels, and its tags", () => {
    const node: OutlineNode = {
      id: "n",
      text: "See [[m|the other]]",
      parentId: null,
      children: [],
      collapsed: false,
      props: {},
      tags: [{ id: "t", name: "idea", color: "#22c55e" }],
      createdAt: "",
      updatedAt: "",
    };
    const item: CanvasNode = { id: "c", type: "kb-node", nodeId: "n", ...at };
    const face = cardFaceOf(item, new Map([["n", node]]), loading);
    expect(face.kind).toBe("note");
    if (face.kind !== "note") return;
    expect(face.text).not.toContain("[[");
    expect(face.tags).toEqual([{ name: "idea", color: "#22c55e" }]);
  });

  test("a card whose node is gone says so", () => {
    const item: CanvasNode = { id: "c", type: "kb-node", nodeId: "gone", ...at };
    expect(cardFaceOf(item, new Map(), loading)).toEqual({
      kind: "missing",
      label: "missing gone",
    });
  });

  test("an item type kb does not know shows its type", () => {
    const item: CanvasNode = { id: "l", type: "link", ...at };
    expect(cardFaceOf(item, new Map(), loading)).toEqual({ kind: "other", label: "link" });
  });

  test("an image shows the picture at its asset's route, as the 2D canvas loads it", () => {
    const asked: string[] = [];
    const item: CanvasNode = { id: "i", type: "file", file: "assets/01ABC.png", ...at };
    const face = cardFaceOf(item, new Map(), (src) => {
      asked.push(src);
      return { state: "missing" };
    });
    expect(face).toEqual({
      kind: "image",
      src: "/assets/01ABC.png",
      picture: { state: "missing" },
    });
    expect(asked).toEqual(["/assets/01ABC.png"]);
  });

  test("a picture anywhere but kb's own assets is not drawn: it shows its path, and nothing is fetched", () => {
    for (const file of ["https://evil.example/x.png", "/elsewhere/x.png", "../x.png", "x.png"]) {
      const item: CanvasNode = { id: "e", type: "file", file, ...at };
      expect(isPicture(file)).toBe(false);
      const face = cardFaceOf(item, new Map(), () => {
        throw new Error("nothing is fetched");
      });
      expect(face).toEqual({ kind: "other", label: file });
    }
    expect(isPicture("assets/01ABC.png")).toBe(true);
  });

  test("a file that is not a picture shows its path, and no picture is asked for", () => {
    const item: CanvasNode = { id: "n", type: "file", file: "notes/plan.md", ...at };
    const face = cardFaceOf(item, new Map(), () => {
      throw new Error("not a picture");
    });
    expect(face).toEqual({ kind: "other", label: "notes/plan.md" });
  });

  test("a faint colour is composited over the face in sRGB, as the DOM does", () => {
    expect(over(look, "rgb(0, 0, 0)", 0.12)).toBe("rgb(224, 224, 224)");
  });
});
