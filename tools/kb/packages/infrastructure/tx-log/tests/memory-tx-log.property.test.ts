/**
 * The log's one promise, checked over arbitrary histories: what a reader at
 * rev `k` is told, plus what it already had, is the whole log — and when the
 * window can no longer say that, it says `"snapshot-required"` instead of
 * lying.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { KbNode, KbTx, StoreTx } from "@kb/model";
import { MemoryTxLog, TX_LOG_DEFAULT_CAPACITY } from "../src/index.ts";

const AT = "2026-01-01T00:00:00.000Z";

function node(id: string): KbNode {
  return {
    id,
    text: id,
    props: {},
    children: [],
    createdAt: AT,
    updatedAt: AT,
  };
}

const txArb: fc.Arbitrary<StoreTx> = fc.record({
  upserts: fc
    .array(fc.stringMatching(/^n[a-z]{1,6}$/), { maxLength: 3 })
    .map((ids) => ids.map(node)),
  deletes: fc.array(fc.stringMatching(/^n[a-z]{1,6}$/), { maxLength: 3 }),
});

describe("MemoryTxLog", () => {
  test("head counts appends; since(head) is empty", () => {
    fc.assert(
      fc.property(fc.array(txArb, { maxLength: 20 }), (txs) => {
        const log = new MemoryTxLog();
        for (const tx of txs) log.append(tx, AT);
        expect(log.head).toBe(txs.length);
        expect(log.since(log.head)).toEqual([]);
        // A reader ahead of head counted in another process (rev is
        // per-server and resets on restart): nothing here describes its graph.
        expect(log.since(log.head + 5)).toBe("snapshot-required");
      }),
    );
  });

  test("since(k) is exactly the appends after k, in order", () => {
    fc.assert(
      fc.property(fc.array(txArb, { minLength: 1, maxLength: 20 }), fc.nat(20), (txs, cut) => {
        const log = new MemoryTxLog();
        const appended = txs.map((tx) => log.append(tx, AT));
        const k = Math.min(cut, txs.length);
        const caught = log.since(k);
        expect(caught).not.toBe("snapshot-required");
        expect(caught).toEqual(appended.slice(k));
        // …and the prefix the reader already had, plus the catch-up, is the log.
        expect([...appended.slice(0, k), ...(caught as typeof appended)]).toEqual(appended);
      }),
    );
  });

  test("snapshot-required exactly at the ring boundary", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 0, max: 12 }), (cap, extra) => {
        const log = new MemoryTxLog(cap);
        const total = cap + extra;
        for (let i = 0; i < total; i += 1) log.append({ upserts: [], deletes: [] }, AT);
        // The window holds revs (head - cap, head]. rev = head - cap is the
        // oldest reader that can still be caught up; one behind it cannot.
        const oldestServable = log.head - cap;
        expect(log.since(oldestServable)).toHaveLength(cap);
        if (oldestServable > 0) expect(log.since(oldestServable - 1)).toBe("snapshot-required");
      }),
    );
  });

  test("subscribers see every append until they unsubscribe", () => {
    const log = new MemoryTxLog();
    const seen: number[] = [];
    const off = log.subscribe((tx) => seen.push(tx.rev));
    log.append({ upserts: [], deletes: [] }, AT);
    log.append({ upserts: [], deletes: [] }, AT, "client-a");
    off();
    log.append({ upserts: [], deletes: [] }, AT);
    expect(seen).toEqual([1, 2]);
    const caught = log.since(1);
    expect(caught).not.toBe("snapshot-required");
    expect((caught as KbTx[]).at(0)?.origin).toBe("client-a");
    expect(log.head).toBe(3);
  });

  test("the default window is the documented capacity", () => {
    const log = new MemoryTxLog();
    for (let i = 0; i < TX_LOG_DEFAULT_CAPACITY + 1; i += 1) {
      log.append({ upserts: [], deletes: [] }, AT);
    }
    expect(log.since(1)).toHaveLength(TX_LOG_DEFAULT_CAPACITY);
    expect(log.since(0)).toBe("snapshot-required");
  });
});
