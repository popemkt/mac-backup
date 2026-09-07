/**
 * The log's one promise, checked over arbitrary histories: what a reader at
 * rev `k` is told, plus what it already had, is the whole sequence — and when
 * the tail can no longer say that, the log says `"snapshot-required"` instead
 * of lying.
 *
 * Over {@link MemoryTxTail}, because these are the properties of the *view*:
 * how head moves, who gets notified, and where `since` refuses. What a durable
 * tail must do — a rev that survives a reopen, a tail that knows when it is
 * behind its store — is the store's, and `logContract` in `@kb/test-kit` runs
 * it against both adapters.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { KbNode, KbTx, StoreTx } from "@kb/model";
import { MemoryTxTail, StoreTxLog } from "../src/index.ts";

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

function logOver(tail: MemoryTxTail = new MemoryTxTail()): StoreTxLog {
  return new StoreTxLog(tail);
}

function frames(answer: KbTx[] | "snapshot-required"): KbTx[] {
  expect(answer).not.toBe("snapshot-required");
  return answer === "snapshot-required" ? [] : answer;
}

describe("StoreTxLog", () => {
  test("head counts appends; since(head) is empty", () => {
    fc.assert(
      fc.property(fc.array(txArb, { maxLength: 20 }), (txs) => {
        const log = logOver();
        for (const tx of txs) log.append(tx, AT);
        expect(log.head).toBe(txs.length);
        expect(log.since(log.head)).toEqual([]);
        // A reader ahead of head counted against another store; nothing this
        // tail holds describes the graph it has.
        expect(log.since(log.head + 5)).toBe("snapshot-required");
      }),
    );
  });

  test("since(k) is exactly the appends after k, in order", () => {
    fc.assert(
      fc.property(fc.array(txArb, { minLength: 1, maxLength: 20 }), fc.nat(20), (txs, cut) => {
        const log = logOver();
        const appended = txs.map((tx) => log.append(tx, AT));
        const k = Math.min(cut, txs.length);
        const caught = frames(log.since(k));
        expect(caught).toEqual(appended.slice(k));
        // …and the prefix the reader already had, plus the catch-up, is the log.
        expect([...appended.slice(0, k), ...caught]).toEqual(appended);
      }),
    );
  });

  test("snapshot-required exactly at the compaction boundary", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 0, max: 12 }), (cap, extra) => {
        // A tail that keeps only its newest `cap` records — what compaction
        // leaves, whatever the backend does it.
        const tail = new MemoryTxTail();
        const log = new StoreTxLog(tail);
        const total = cap + extra;
        for (let i = 0; i < total; i += 1) {
          log.append({ upserts: [], deletes: [] }, AT);
          tail.adopt(tail.entries().slice(-cap));
        }
        // The tail holds revs (head - cap, head]. rev = head - cap is the
        // oldest reader that can still be caught up; one behind it cannot.
        const oldestServable = log.head - cap;
        expect(frames(log.since(oldestServable))).toHaveLength(cap);
        if (oldestServable > 0) expect(log.since(oldestServable - 1)).toBe("snapshot-required");
      }),
    );
  });

  test("subscribers see every append until they unsubscribe", () => {
    const log = logOver();
    const seen: number[] = [];
    const off = log.subscribe((tx) => seen.push(tx.rev));
    log.append({ upserts: [], deletes: [] }, AT);
    log.append({ upserts: [], deletes: [] }, AT, "client-a");
    off();
    log.append({ upserts: [], deletes: [] }, AT);
    expect(seen).toEqual([1, 2]);
    expect(frames(log.since(1)).at(0)?.origin).toBe("client-a");
    expect(log.head).toBe(3);
  });

  test("a log opens at the tail's head and refreshes to what the tail gained", () => {
    const tail = new MemoryTxTail();
    const writer = new StoreTxLog(tail);
    writer.append({ upserts: [node("n-a")], deletes: [] }, AT);
    writer.append({ upserts: [node("n-b")], deletes: [] }, AT);

    // A second session over the same tail — a restart, or another process.
    const reader = new StoreTxLog(tail);
    expect(reader.head).toBe(2);

    const seen: number[] = [];
    reader.subscribe((tx) => seen.push(tx.rev));
    expect(reader.refresh()).toEqual([]);

    writer.append({ upserts: [node("n-c")], deletes: [] }, AT);
    expect(reader.refresh().map((tx) => tx.rev)).toEqual([3]);
    expect(seen).toEqual([3]);
    expect(reader.head).toBe(3);
    // Refreshing again adopts nothing and notifies nobody.
    expect(reader.refresh()).toEqual([]);
    expect(seen).toEqual([3]);
  });
});
