import { describe, expect, it, test } from "vitest";
import { fitGraphLabel, reserveGraphLabel, type GraphLabelBox } from "./graph-label-layout";

test("higher priority labels keep their space while disjoint labels remain visible", () => {
  const occupied: GraphLabelBox[] = [];
  expect(reserveGraphLabel({ x: 10, y: 10, width: 100, height: 24 }, occupied)).toBe(true);
  expect(reserveGraphLabel({ x: 80, y: 20, width: 100, height: 24 }, occupied)).toBe(false);
  expect(reserveGraphLabel({ x: 10, y: 40, width: 100, height: 24 }, occupied)).toBe(true);
  expect(occupied).toHaveLength(2);
});

const measure = (text: string) =>
  Array.from(text).reduce((width, char) => width + (char === "W" ? 12 : 6), 0);
describe("graph label space", () => {
  it("keeps meaningful ordinary labels independent of node size", () => {
    expect(fitGraphLabel("Knowledge relationships", measure)).toBe("Knowledge relationships");
  });
  it("fits measured glyph widths without cutting Unicode codepoints", () => {
    const label = fitGraphLabel("WWWWWWWWWWWWWWWWWWWWWWWW", measure, 70);
    expect(measure(label)).toBeLessThanOrEqual(70);
    expect(label.endsWith("…")).toBe(true);
    expect(fitGraphLabel("🌱🌱🌱🌱", () => 100, 20)).toBe("…");
  });
});
