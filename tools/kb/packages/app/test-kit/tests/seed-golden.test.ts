import { describe, expect, test } from "bun:test";
import { canonicalJsonl } from "@kb/model";
import { bundledSeed } from "@kb/bundled";
import { CONTRACT_AT, seedGolden } from "@kb/test-kit";

/*
 * The fresh seed, whole and keyed by id, is the golden byte for byte: moving a
 * family's ids to its own package moves no node, and no parent's children
 * reorder. A deliberate seed change regenerates the file in the same commit.
 */
describe("seed golden", () => {
  test("a fresh store's seed is the golden, children order included", () => {
    expect(canonicalJsonl(bundledSeed(CONTRACT_AT))).toBe(seedGolden());
  });
});
