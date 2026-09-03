import { describe, expect, it } from "vitest";
import { mapOffset } from "./caret";

describe("mapOffset", () => {
  it("maps a captured offset through a split instead of clamping it", () => {
    expect(mapOffset({ kind: "split", offset: 3, side: "right" }, 5)).toBe(2);
  });

  it("preserves a right-hand offset through a merge", () => {
    expect(mapOffset({ kind: "merge", leftLength: 3, source: "right" }, 2)).toBe(5);
  });
});
