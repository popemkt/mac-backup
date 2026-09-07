import { describe, expect, it } from "vitest";
import { graphEmphasisAlpha, graphNeighborhood } from "./graph-interaction";
describe("graph emphasis", () => {
  it("a zero-match search dims every node", () => {
    expect(graphEmphasisAlpha("a", { highlightIds: new Set() }, null)).toBe(0.2);
  });
  it("retains every relationship carrier in the selected neighbourhood", () => {
    const neighborhood = graphNeighborhood("a", [
      { source: "a", target: "b", kind: "child", weight: 1 },
      { source: "c", target: "a", kind: "ref-prop", weight: 1 },
      { source: "a", target: "d", kind: "mention", weight: 1 },
    ]);
    expect(neighborhood).toEqual(new Set(["a", "b", "c", "d"]));
    expect(graphEmphasisAlpha("c", {}, neighborhood)).toBe(1);
    expect(graphEmphasisAlpha("outside", {}, neighborhood)).toBe(0.2);
  });
  it("search and legend combine without erasing the selection neighbourhood", () => {
    expect(
      graphEmphasisAlpha(
        "b",
        { highlightIds: new Set(["a"]), filterIds: new Set(["b"]) },
        new Set(["a", "b"]),
      ),
    ).toBe(0.2);
  });
});
