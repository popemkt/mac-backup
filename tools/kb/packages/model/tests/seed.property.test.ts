/**
 * Seed idempotence (fast-check): src/foundation/seed.ts's ensureSystemSeed.
 * Applied to an already-seeded store it is a no-op, and its fill-absent pass
 * fills only genuinely missing prop keys — a present value, even one a user
 * modified away from the fresh default, is never rewritten.
 *
 * Excludes seed.ts's exported TEMPLATE_TAGS: those get a separate, deliberate
 * "merge missing template field refs" pass (documented in seed.ts) distinct
 * from the generic fill-absent invariant under test here. The list is imported,
 * not restated, so adding a template tag cannot silently break this property.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { KbNode, PropValue } from "../src/model.ts";
import { TEMPLATE_TAGS, ensureSystemSeed, systemSeedNodes } from "../src/seed.ts";
import { expectDefined } from "@kb/test-kit";

const AT = "2026-08-24T00:00:00.000Z";
const EXCLUDED = new Set<string>(TEMPLATE_TAGS);
const CANDIDATE_IDS = systemSeedNodes(AT)
  .map((n) => n.id)
  .filter((id) => !EXCLUDED.has(id));

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
              const keep = expectDefined(keepFlags[flagIdx++ % keepFlags.length]);
              // Keep the key with a value that DIFFERS from the fresh default
              // (a user edit), or drop it entirely (an older, unmigrated store).
              if (keep) nextProps[key] = [{ t: "str", v: `__sentinel-${flagIdx}__` }];
            }
            return { ...node, props: nextProps };
          });

          const result = ensureSystemSeed(existingNodes);
          const resultById = new Map(result.nodes.map((n) => [n.id, n]));

          for (const id of selectedIds) {
            const before = expectDefined(existingNodes.find((n) => n.id === id));
            const after = expectDefined(resultById.get(id));
            const fresh = expectDefined(baseById.get(id));

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
