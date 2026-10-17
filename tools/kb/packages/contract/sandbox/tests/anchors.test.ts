import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { Window } from "happy-dom";
import {
  KB_METHODS,
  PageMessage,
  drawingToDom,
  notification,
  placeAnchored,
  sanitizeDrawing,
  type AnchoredElement,
} from "../src/index.ts";

/** A drawing built into a fresh document's body, as the frame builds it. */
function drawn(drawing: unknown) {
  const doc = new Window().document;
  const box = doc.createElement("div");
  for (const child of drawingToDom(doc, sanitizeDrawing(drawing, 100).nodes)) {
    box.appendChild(child);
  }
  return box;
}

/** The inline style the frame left on the drawn element `id`. */
function styleOf(box: ReturnType<typeof drawn>, id: string): AnchoredElement["style"] | undefined {
  return (box.querySelector(`#${id}`) as unknown as AnchoredElement | null)?.style;
}

describe("an anchored drawing", () => {
  test("stands each anchored element on its thing's rectangle, and hides one not drawn", () => {
    const box = drawn([
      ["div", { "data-anchor": "a", id: "on-a" }, "a"],
      ["div", { "data-anchor": "gone", id: "on-gone" }],
      ["p", { id: "free" }, "not anchored"],
    ]);
    placeAnchored(box, { a: { left: 10, top: 20, right: 110, bottom: 70 } });
    const onA = styleOf(box, "on-a");
    expect(onA?.position).toBe("fixed");
    expect([onA?.left, onA?.top, onA?.width, onA?.height]).toEqual([
      "10px",
      "20px",
      "100px",
      "50px",
    ]);
    expect(styleOf(box, "on-gone")?.display).toBe("none");
    expect(styleOf(box, "free")?.position).toBe("");
  });

  test("follows its thing when it moves, and shows again when it is drawn again", () => {
    const box = drawn(["div", { "data-anchor": "a", id: "on-a" }]);
    placeAnchored(box, {});
    placeAnchored(box, { a: { left: 1, top: 2, right: 3, bottom: 4 } });
    expect(styleOf(box, "on-a")?.display).toBe("");
    expect(styleOf(box, "on-a")?.left).toBe("1px");
  });

  test("the page tells a frame where its view's things are, and nothing malformed passes", () => {
    const decode = Schema.decodeUnknownSync(PageMessage);
    const anchors = { a: { left: 0, top: 0, right: 5, bottom: 5 } };
    expect(decode(notification(KB_METHODS.anchors, { anchors }))).toMatchObject({
      params: { anchors },
    });
    expect(() =>
      decode(notification(KB_METHODS.anchors, { anchors: { a: { left: "0" } } })),
    ).toThrow();
  });
});
