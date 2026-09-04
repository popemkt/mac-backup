import { describe, expect, it } from "vitest";
import { formatGraphLabel, graphLabelMetrics } from "./graph-label";

describe("graph labels", () => {
  it("increases available label length monotonically with radius", () => {
    expect(graphLabelMetrics(4).maxLen).toBe(4);
    expect(graphLabelMetrics(20).maxLen).toBeGreaterThan(graphLabelMetrics(8).maxLen);
  });

  it("truncates at the render-derived size", () => {
    expect(formatGraphLabel("abcdefgh", 8)).toBe("abc…");
  });
});
