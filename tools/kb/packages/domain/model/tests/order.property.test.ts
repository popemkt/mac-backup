import { describe, expect, test } from "bun:test";
import { present } from "../src/present.ts";
import fc from "fast-check";
import type { KbNode } from "../src/model.ts";
import { compareRootOrder, migrateOrderKeys, rankBetween, ranksFor } from "../src/order.ts";

describe("order properties (fast-check)", () => {
  test("ranksFor strictly preserves input order and assigns distinct ranks", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 30 }), {
          minLength: 0,
          maxLength: 100,
        }),
        (ids) => {
          const ranks = ranksFor(ids);
          expect(ranks.size).toBe(ids.length);

          const rankList = ids.map((id) => present(ranks.get(id), "expected ranks.get(id)"));
          for (let i = 0; i < rankList.length - 1; i++) {
            expect(
              present(rankList[i], "expected rankList[i]") <
                present(rankList[i + 1], "expected rankList[i + 1]"),
            ).toBe(true);
          }

          const uniqueRanks = new Set(rankList);
          expect(uniqueRanks.size).toBe(ids.length);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("arbitrary sequence of insertions maintains strictly increasing ranks", () => {
    // Generate commands: insert at random index in the current list
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 50 }), (indices) => {
        const ranks: string[] = [];

        for (const rawIndex of indices) {
          const index = ranks.length === 0 ? 0 : rawIndex % (ranks.length + 1);
          const before = index > 0 ? ranks[index - 1] : undefined;
          const after = index < ranks.length ? ranks[index] : undefined;

          const newRank = rankBetween(before, after);
          ranks.splice(index, 0, newRank);
        }

        for (let i = 0; i < ranks.length - 1; i++) {
          expect(
            present(ranks[i], "expected ranks[i]") < present(ranks[i + 1], "expected ranks[i + 1]"),
          ).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  test("adversarial insertion chains: repeated prepend, append, and bisect", () => {
    // 1. Repeated prepend
    const prependList: string[] = [];
    for (let i = 0; i < 50; i++) {
      const first = prependList[0];
      const next = rankBetween(undefined, first);
      prependList.unshift(next);
    }
    for (let i = 0; i < prependList.length - 1; i++) {
      expect(
        present(prependList[i], "expected prependList[i]") <
          present(prependList[i + 1], "expected prependList[i + 1]"),
      ).toBe(true);
    }

    // 2. Repeated append
    const appendList: string[] = [];
    for (let i = 0; i < 50; i++) {
      const last = appendList[appendList.length - 1];
      const next = rankBetween(last, undefined);
      appendList.push(next);
    }
    for (let i = 0; i < appendList.length - 1; i++) {
      expect(
        present(appendList[i], "expected appendList[i]") <
          present(appendList[i + 1], "expected appendList[i + 1]"),
      ).toBe(true);
    }

    // 3. Repeated insertion between the same two neighbors (suffix extension)
    const left = rankBetween(undefined, undefined);
    const right = rankBetween(left, undefined);
    const middleList: string[] = [left, right];

    for (let i = 0; i < 40; i++) {
      // Always insert right before the last element (between middleList[middleList.length-2] and middleList[middleList.length-1])
      const prev = present(
        middleList[middleList.length - 2],
        "expected middleList[middleList.length - 2]",
      );
      const last = present(
        middleList[middleList.length - 1],
        "expected middleList[middleList.length - 1]",
      );
      const mid = rankBetween(prev, last);
      middleList.splice(middleList.length - 1, 0, mid);
    }

    for (let i = 0; i < middleList.length - 1; i++) {
      expect(
        present(middleList[i], "expected middleList[i]") <
          present(middleList[i + 1], "expected middleList[i + 1]"),
      ).toBe(true);
    }
  });

  test("migrateOrderKeys preserves child-group visible order across arbitrary already-ranked / gap patterns", () => {
    const NOW = "2026-08-24T00:00:00.000Z";

    fc.assert(
      fc.property(
        fc
          .integer({ min: 2, max: 15 })
          .chain((n) =>
            fc.tuple(fc.constant(n), fc.array(fc.boolean(), { minLength: n, maxLength: n })),
          ),
        ([n, hasOrderFlags]) => {
          const childIds = Array.from({ length: n }, (_, i) => `c${i}`);
          let counter = 0;
          const orders: (string | undefined)[] = hasOrderFlags.map((flag) =>
            flag ? String((counter += 100)).padStart(10, "0") : undefined,
          );

          const parent: KbNode = {
            id: "parent",
            text: "parent",
            props: {},
            children: childIds,
            createdAt: NOW,
            updatedAt: NOW,
          };
          const childNodes: KbNode[] = childIds.map((id, i) => ({
            id,
            text: id,
            props: {},
            children: [],
            createdAt: NOW,
            updatedAt: NOW,
            order: orders[i],
          }));

          const { nodes: migrated } = migrateOrderKeys([parent, ...childNodes]);
          const byId = new Map(migrated.map((node) => [node.id, node]));

          // Every child now has an order.
          for (const id of childIds)
            expect(present(byId.get(id), "expected byId.get(id)").order).toBeDefined();

          // Pre-existing orders are byte-for-byte untouched.
          childIds.forEach((id, i) => {
            const existing = orders[i];
            if (existing !== undefined && existing !== "") {
              expect(present(byId.get(id), "expected byId.get(id)").order).toBe(existing);
            }
          });

          // Final order strictly increases along the ORIGINAL children[] sequence,
          // regardless of how many consecutive gaps sit between ranked neighbours.
          for (let i = 0; i < childIds.length - 1; i++) {
            const a = present(
              present(
                byId.get(present(childIds[i], "expected childIds[i]")),
                "expected byId.get(childIds[i])",
              ).order,
              "expected byId.get(childIds[i]).order",
            );
            const b = present(
              present(
                byId.get(present(childIds[i + 1], "expected childIds[i + 1]")),
                "expected byId.get(childIds[i + 1])",
              ).order,
              "expected byId.get(childIds[i + 1]).order",
            );
            expect(a < b).toBe(true);
          }

          expect(migrateOrderKeys(migrated).changed).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("migrateOrderKeys assigns root order matching the documented has-order-first, then-id fallback", () => {
    const NOW = "2026-08-24T00:00:00.000Z";

    fc.assert(
      fc.property(
        fc
          .uniqueArray(fc.stringMatching(/^r[a-z0-9]{1,8}$/), {
            minLength: 2,
            maxLength: 15,
          })
          .chain((ids) =>
            fc.tuple(
              fc.constant(ids),
              fc.array(fc.boolean(), { minLength: ids.length, maxLength: ids.length }),
            ),
          ),
        ([ids, hasOrderFlags]) => {
          let counter = 0;
          const nodes: KbNode[] = ids.map((id, i) => ({
            id,
            text: id,
            props: {},
            children: [],
            createdAt: NOW,
            updatedAt: NOW,
            order:
              hasOrderFlags[i] === true ? String((counter += 100)).padStart(10, "0") : undefined,
          }));
          const before = nodes.map((node) => ({ id: node.id, order: node.order }));
          const expectedOrder = [...before].toSorted(compareRootOrder).map((n) => n.id);

          const { nodes: migrated } = migrateOrderKeys(nodes);
          const byId = new Map(migrated.map((node) => [node.id, node]));
          const actualOrder = [...ids].toSorted((a, b) =>
            compareRootOrder(
              present(byId.get(a), "expected byId.get(a)"),
              present(byId.get(b), "expected byId.get(b)"),
            ),
          );

          expect(actualOrder).toEqual(expectedOrder);
          expect(migrateOrderKeys(migrated).changed).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("ranks are stable across a JSON serialize/parse round trip", () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 2, maxLength: 30 }), (indices) => {
        const ranks: string[] = [];
        for (const rawIndex of indices) {
          const index = ranks.length === 0 ? 0 : rawIndex % (ranks.length + 1);
          const before = index > 0 ? ranks[index - 1] : undefined;
          const after = index < ranks.length ? ranks[index] : undefined;
          ranks.splice(index, 0, rankBetween(before, after));
        }

        // A rank's job is to sort correctly after living inside a JSON prop
        // value on the wire and in storage — round trip it exactly there.
        const roundTripped: string[] = JSON.parse(JSON.stringify(ranks));
        expect(roundTripped).toEqual(ranks);
        for (let i = 0; i < roundTripped.length - 1; i++) {
          expect(
            present(roundTripped[i], "expected roundTripped[i]") <
              present(roundTripped[i + 1], "expected roundTripped[i + 1]"),
          ).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });
});

/** A well-formed rank: base-36 characters, never ending in `0`, any length. */
const rankArb = fc
  .array(fc.constantFrom(..."0123456789abcdefghijklmnopqrstuvwxyz".split("")), {
    minLength: 1,
    maxLength: 40,
  })
  .map((chars) => chars.join("").replace(/0+$/, ""))
  .filter((rank) => rank.length > 0);

const WELL_FORMED = /^[0-9a-z]*[1-9a-z]$/;

describe("rankBetween (fast-check)", () => {
  test("a < between(a, b) < b for any two distinct ranks, long ones included", () => {
    fc.assert(
      fc.property(rankArb, rankArb, (x, y) => {
        fc.pre(x !== y);
        const [a, b] = x < y ? [x, y] : [y, x];
        const mid = rankBetween(a, b);
        expect(a < mid && mid < b).toBe(true);
        expect(mid).toMatch(WELL_FORMED);
      }),
      { numRuns: 2000 },
    );
  });

  test("open bounds: below any rank, above any rank, both well formed", () => {
    fc.assert(
      fc.property(rankArb, (rank) => {
        const below = rankBetween(undefined, rank);
        const above = rankBetween(rank, undefined);
        expect(below < rank && rank < above).toBe(true);
        expect(below).toMatch(WELL_FORMED);
        expect(above).toMatch(WELL_FORMED);
      }),
      { numRuns: 1000 },
    );
  });

  test("a legacy fixed-width bound with trailing zeros is read as its value", () => {
    // "1000000000" is "1" padded to the old fixed width.
    const mid = rankBetween("0c85fmexyn", "1000000000");
    expect("0c85fmexyn" < mid && mid < "1000000000").toBe(true);
    expect(() => rankBetween("1", "10")).toThrow(RangeError);
    expect(() => rankBetween("b", "a")).toThrow(RangeError);
    expect(() => rankBetween("a", "a")).toThrow(RangeError);
  });

  test("tail appends step: 1000 appends stay strictly increasing and short", () => {
    const ranks: string[] = [];
    for (let i = 0; i < 1000; i++) ranks.push(rankBetween(ranks.at(-1), undefined));
    for (let i = 1; i < ranks.length; i++) {
      expect(present(ranks[i - 1], "prev") < present(ranks[i], "cur")).toBe(true);
    }
    // One character per 35 appends, not one per append once a halving gap runs out.
    expect(Math.max(...ranks.map((r) => r.length))).toBeLessThanOrEqual(30);
    expect(present(ranks[199], "200th").length).toBeLessThanOrEqual(7);
  });

  test("head inserts step the same way", () => {
    const ranks: string[] = [];
    for (let i = 0; i < 500; i++) ranks.unshift(rankBetween(undefined, ranks[0]));
    for (let i = 1; i < ranks.length; i++) {
      expect(present(ranks[i - 1], "prev") < present(ranks[i], "cur")).toBe(true);
    }
    expect(Math.max(...ranks.map((r) => r.length))).toBeLessThanOrEqual(16);
  });

  test("ranksFor spreads a group with room between neighbours and short keys", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `n${i}`);
    const ranks = [...ranksFor(ids).values()];
    expect(Math.max(...ranks.map((r) => r.length))).toBeLessThanOrEqual(3);
    for (const rank of ranks) expect(rank).toMatch(WELL_FORMED);
    for (let i = 1; i < ranks.length; i++) {
      const low = present(ranks[i - 1], "low");
      const high = present(ranks[i], "high");
      expect(rankBetween(low, high).length).toBeLessThanOrEqual(3);
    }
  });
});
