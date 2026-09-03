import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { KbNode, NodeId } from "../src/model.ts";
import { migrateOrderKeys, rankBetween, ranksFor } from "../src/order.ts";

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

          const rankList = ids.map((id) => ranks.get(id)!);
          for (let i = 0; i < rankList.length - 1; i++) {
            expect(rankList[i]! < rankList[i + 1]!).toBe(true);
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
          expect(ranks[i]! < ranks[i + 1]!).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  test("adversarial insertion chains: repeated prepend, append, and bisect", () => {
    // 1. Repeated prepend
    let prependList: string[] = [];
    for (let i = 0; i < 50; i++) {
      const first = prependList[0];
      const next = rankBetween(undefined, first);
      prependList = [next, ...prependList];
    }
    for (let i = 0; i < prependList.length - 1; i++) {
      expect(prependList[i]! < prependList[i + 1]!).toBe(true);
    }

    // 2. Repeated append
    const appendList: string[] = [];
    for (let i = 0; i < 50; i++) {
      const last = appendList[appendList.length - 1];
      const next = rankBetween(last, undefined);
      appendList.push(next);
    }
    for (let i = 0; i < appendList.length - 1; i++) {
      expect(appendList[i]! < appendList[i + 1]!).toBe(true);
    }

    // 3. Repeated insertion between the same two neighbors (suffix extension)
    const left = rankBetween(undefined, undefined);
    const right = rankBetween(left, undefined);
    const middleList: string[] = [left, right];

    for (let i = 0; i < 40; i++) {
      // Always insert right before the last element (between middleList[middleList.length-2] and middleList[middleList.length-1])
      const prev = middleList[middleList.length - 2]!;
      const last = middleList[middleList.length - 1]!;
      const mid = rankBetween(prev, last);
      middleList.splice(middleList.length - 1, 0, mid);
    }

    for (let i = 0; i < middleList.length - 1; i++) {
      expect(middleList[i]! < middleList[i + 1]!).toBe(true);
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
          for (const id of childIds) expect(byId.get(id)!.order).toBeDefined();

          // Pre-existing orders are byte-for-byte untouched.
          childIds.forEach((id, i) => {
            if (orders[i]) expect(byId.get(id)!.order).toBe(orders[i]);
          });

          // Final order strictly increases along the ORIGINAL children[] sequence,
          // regardless of how many consecutive gaps sit between ranked neighbours.
          for (let i = 0; i < childIds.length - 1; i++) {
            const a = byId.get(childIds[i]!)!.order!;
            const b = byId.get(childIds[i + 1]!)!.order!;
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

    /** Mirrors the comparator documented in order.ts's forest-root sort. */
    function referenceRootCompare(
      a: { id: NodeId; order?: string },
      b: { id: NodeId; order?: string },
    ): number {
      const oa = a.order;
      const ob = b.order;
      if (oa && ob) return oa < ob ? -1 : oa > ob ? 1 : 0;
      if (oa) return -1;
      if (ob) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }

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
            order: hasOrderFlags[i] ? String((counter += 100)).padStart(10, "0") : undefined,
          }));
          const before = nodes.map((node) => ({ id: node.id, order: node.order }));
          const expectedOrder = [...before].sort(referenceRootCompare).map((n) => n.id);

          const { nodes: migrated } = migrateOrderKeys(nodes);
          const byId = new Map(migrated.map((node) => [node.id, node]));
          const actualOrder = [...ids].sort((a, b) =>
            byId.get(a)!.order!.localeCompare(byId.get(b)!.order!),
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
          expect(roundTripped[i]! < roundTripped[i + 1]!).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });
});
