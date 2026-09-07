import { expect, test } from "vitest";
import { reserveGraphLabel, type GraphLabelBox } from "./graph-label-layout";

test("higher priority labels keep their space while disjoint labels remain visible", () => {
  const occupied: GraphLabelBox[] = [];
  expect(reserveGraphLabel({ x: 10, y: 10, width: 100, height: 24 }, occupied)).toBe(true);
  expect(reserveGraphLabel({ x: 80, y: 20, width: 100, height: 24 }, occupied)).toBe(false);
  expect(reserveGraphLabel({ x: 10, y: 40, width: 100, height: 24 }, occupied)).toBe(true);
  expect(occupied).toHaveLength(2);
});
