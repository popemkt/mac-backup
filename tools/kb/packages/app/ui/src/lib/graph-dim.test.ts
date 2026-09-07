import { describe, expect, it } from "vitest";
import { composeGraphAlpha, graphNodeAlpha, withGraphAlpha } from "./graph-dim";

describe("graph dim", () => {
  it("keeps dimmed nodes readable when emphasis constraints overlap", () => {
    expect(composeGraphAlpha(0.2, 0.2, 1)).toBeCloseTo(0.2);
    expect(
      graphNodeAlpha({ includedByFilter: false, includedBySearch: true, includedByFocus: false }),
    ).toBeCloseTo(0.2);
  });

  it("preserves semantic colour while varying alpha", () => {
    expect(withGraphAlpha("#ff5f5f", 0.2)).toBe("#ff5f5f33");
    expect(withGraphAlpha("rgba(10, 20, 30, 0.5)", 0.2)).toBe("rgba(10, 20, 30, 0.1)");
  });
});
