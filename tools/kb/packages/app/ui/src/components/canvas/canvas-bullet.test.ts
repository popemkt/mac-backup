/**
 * A canvas node's bullet. The kit draws the canvas kind for a node typed by
 * the family's tag, which it names by a copy of the frozen id because it may
 * not import the family (GAP [canvas-bullet-kind]). This test is the bridge
 * that holds the copy to `CANVAS_IDS`: a canvas node, typed by the family's
 * own tag and with no tag name to go on, still gets the canvas glyph.
 */
import { describe, expect, it } from "vitest";
import { CANVAS_IDS } from "@kb/canvas";
import { bulletAppearance } from "@kb/ui-sdk";

describe("a canvas node's bullet", () => {
  it("is the canvas kind, read from the family's tag by its id", () => {
    const appearance = bulletAppearance({
      hasChildren: false,
      typeRefs: [CANVAS_IDS.canvasTag],
      tagNames: [],
      isSys: false,
      collapsed: false,
      childCount: 0,
    });
    expect(appearance.kind).toBe("canvas");
    expect(appearance.glyph).toBe("◇");
  });
});
