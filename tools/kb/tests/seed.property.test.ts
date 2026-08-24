/**
 * Seed idempotence (fast-check): src/foundation/seed.ts's ensureSystemSeed.
 * Applied to an already-seeded store it is a no-op, and its fill-absent pass
 * fills only genuinely missing prop keys — a present value, even one a user
 * modified away from the fresh default, is never rewritten.
 *
 * Excludes SYSTEM_IDS.graphPerspectiveTag / .ontologyTag: those two get a
 * separate, deliberate "merge missing template field refs" pass (documented
 * in seed.ts) distinct from the generic fill-absent invariant under test here.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { SYSTEM_IDS, type KbNode, type PropValue } from "../src/foundation/model.ts";
import { ensureSystemSeed, systemSeedNodes } from "../src/foundation/seed.ts";

const AT = "2026-08-24T00:00:00.000Z";
const TEMPLATE_TAGS = new Set<string>([
  SYSTEM_IDS.graphPerspectiveTag,
  SYSTEM_IDS.ontologyTag,
]);
const CANDIDATE_IDS = systemSeedNodes(AT)
  .map((n) => n.id)
  .filter((id) => !TEMPLATE_TAGS.has(id));

describe("seed idempotence properties (fast-check)", () => {
  test("ensureSystemSeed over the pristine seed is a no-op", () => {
    const seed = systemSeedNodes(AT);
    const result = ensureSystemSeed(seed);
    expect(result.seeded).toBe(false);
    expect(result.deletes).toEqual([]);
    expect(result.nodes).toEqual(seed);
  });

  test("the fill-absent pass fills only genuinely absent keys, and never rewrites a present (even user-modified) value", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...CANDIDATE_IDS), { minLength: 1, maxLength: 8 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 200 }),
        (selectedIds, keepFlags) => {
          const baseSeed = systemSeedNodes(AT);
          const baseById = new Map(baseSeed.map((n) => [n.id, n]));
          const selected = new Set(selectedIds);
          let flagIdx = 0;

          const existingNodes: KbNode[] = baseSeed.map((node) => {
            if (!selected.has(node.id)) return node;
            const nextProps: Record<string, PropValue[]> = {};
            for (const key of Object.keys(node.props)) {
              const keep = keepFlags[flagIdx++ % keepFlags.length]!;
              // Keep the key with a value that DIFFERS from the fresh default
              // (a user edit), or drop it entirely (an older, unmigrated store).
              if (keep) nextProps[key] = [{ t: "str", v: `__sentinel-${flagIdx}__` }];
            }
            return { ...node, props: nextProps };
          });

          const result = ensureSystemSeed(existingNodes);
          const resultById = new Map(result.nodes.map((n) => [n.id, n]));

          for (const id of selectedIds) {
            const before = existingNodes.find((n) => n.id === id)!;
            const after = resultById.get(id)!;
            const fresh = baseById.get(id)!;

            for (const key of Object.keys(before.props)) {
              expect(after.props[key]).toEqual(before.props[key]);
            }
            for (const key of Object.keys(fresh.props)) {
              if (!(key in before.props)) {
                expect(after.props[key]).toEqual(fresh.props[key]);
              }
            }
          }

          const second = ensureSystemSeed(result.nodes);
          expect(second.seeded).toBe(false);
          expect(second.nodes).toEqual(result.nodes);
        },
      ),
      { numRuns: 500 },
    );
  });
});
