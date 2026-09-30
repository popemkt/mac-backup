import { describe, expect, test } from "vitest";
import type { CanvasNode } from "@kb/canvas";
import type { OutlineNode } from "@/lib/types";
import { cardFaceOf, over, type CardLook } from "./canvas-card-face";

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
    const face = cardFaceOf(item, new Map([["n", node]]));
    expect(face.kind).toBe("note");
    if (face.kind !== "note") return;
    expect(face.text).not.toContain("[[");
    expect(face.tags).toEqual([{ name: "idea", color: "#22c55e" }]);
  });

  test("a card whose node is gone says so", () => {
    const item: CanvasNode = { id: "c", type: "kb-node", nodeId: "gone", ...at };
    expect(cardFaceOf(item, new Map())).toEqual({ kind: "missing", label: "missing gone" });
  });

  test("an item type kb does not know shows its type", () => {
    const item: CanvasNode = { id: "f", type: "file", ...at };
    expect(cardFaceOf(item, new Map())).toEqual({ kind: "other", label: "file" });
  });

  test("a faint colour is composited over the face in sRGB, as the DOM does", () => {
    expect(over(look, "rgb(0, 0, 0)", 0.12)).toBe("rgb(224, 224, 224)");
  });
});
