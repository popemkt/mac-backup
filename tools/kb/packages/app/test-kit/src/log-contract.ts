/**
 * The transaction-log contract: what every store's {@link TxTail} must do,
 * written once and run against each adapter — the same argument
 * {@link storeContract} makes, for the half of the store that records *what
 * changed, in order*.
 *
 * It is written against a store factory rather than a tail factory on purpose.
 * The tail's whole reason to belong to the store is that the node write and the
 * record are one act, and the two properties that matter — a rev that survives
 * a reopen, and a tail that can tell when it is behind the store — are only
 * observable through the store. A tail tested on its own would pass while the
 * store it belongs to lost every entry.
 *
 * Every property runs against a fresh scratch root released by the scope that
 * acquired it, so nothing here can see the owner's live store.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EffectStore } from "@kb/contracts";
import type { KbNode, KbTx, StoreTx } from "@kb/model";
import { StoreTxLog } from "@kb/tx-log";
import type { StoreFactory } from "./store-contract.ts";

/**
 * What the suite needs from an adapter: how to build it, and how to put its
 * tail one record behind its nodes.
 *
 * The second half cannot be port-generic and saying so is the point. "The
 * process died between the node write and the record" is the state the write
 * order is *chosen* for, so the contract has to be able to reach it — but the
 * only way to reach it is to reach past the port, and each backend reaches
 * differently (a line off a file, a row out of a table). The property stays
 * here, where both adapters must pass it; the one line that injects it belongs
 * to the adapter, the way `s1` left the mid-write abort in the sqlite package.
 */
export interface LogAdapter {
  readonly makeStore: StoreFactory;
  /** Remove the tail's newest record, leaving the nodes alone. */
  readonly dropLastRecord: (root: string) => void;
  /**
   * Make the tail refuse writes while still answering reads — the state an
   * append has to survive without moving head.
   */
  readonly breakTail: (root: string) => void;
}

const AT = "2026-01-01T00:00:00.000Z";

function plainNode(id: string, text: string): KbNode {
  return { id, text, props: {}, children: [], createdAt: AT, updatedAt: AT };
}

function upsert(id: string, text: string): StoreTx {
  return { upserts: [plainNode(id, text)], deletes: [] };
}

/** A scratch root for the current scope, removed when the scope closes. */
const scratchRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "kb-log-contract-"))),
  (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
);

function commit(store: EffectStore, tx: StoreTx, origin?: string) {
  return store.commitEffect(tx, origin === undefined ? { at: AT } : { at: AT, origin });
}

/**
 * Every property, as a named check over an adapter — the same
 * list-of-functions shape `store-contract.ts` uses, so a property reads on its
 * own.
 */
const PROPERTIES: ReadonlyArray<readonly [string, (adapter: LogAdapter) => Promise<void>]> = [
  ["an unwritten store has an empty tail that is current", emptyTailIsCurrent],
  ["a commit is recorded: one entry, the caller's `at` and `origin`", commitIsRecorded],
  ["rev is monotonic and survives a reopen", revSurvivesReopen],
  ["a reopened log serves `since` from the durable tail", sinceAfterReopen],
  ["`since` beyond head is snapshot-required", sinceBeyondHead],
  ["an empty commit records nothing", emptyCommitRecordsNothing],
  ["an append that cannot be written leaves head unchanged", failedAppendKeepsHead],
  ["a store written without its tail reports itself behind", storeAheadOfTailIsDetected],
  ["a log over a stale tail refuses to serve frames", staleTailForcesSnapshot],
  ["a virtual transaction is recorded without touching the nodes", virtualTxIsRecorded],
];

function emptyTailIsCurrent(adapter: LogAdapter): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = adapter.makeStore(yield* scratchRoot);
        expect(store.txTail.head()).toBe(0);
        expect(store.txTail.entries()).toEqual([]);
        expect(store.txTail.isCurrent()).toBe(true);
        expect(new StoreTxLog(store.txTail).head).toBe(0);
      }),
    ),
  );
}

function commitIsRecorded(adapter: LogAdapter): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = adapter.makeStore(yield* scratchRoot);
        yield* commit(store, upsert("n-a", "a"), "client-a");

        const entries = store.txTail.entries();
        expect(entries).toHaveLength(1);
        expect(entries[0]?.rev).toBe(1);
        expect(entries[0]?.at).toBe(AT);
        expect(entries[0]?.origin).toBe("client-a");
        expect(entries[0]?.ops.upserts.map((n) => n.id)).toEqual(["n-a"]);
        expect(store.txTail.isCurrent()).toBe(true);
      }),
    ),
  );
}

function revSurvivesReopen(adapter: LogAdapter): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const store = adapter.makeStore(root);
        yield* commit(store, upsert("n-a", "a"));
        yield* commit(store, upsert("n-b", "b"));
        expect(store.txTail.head()).toBe(2);

        // A second instance over the same files is how "another process" is
        // spelled in port terms — and how a restart is.
        const reopened = adapter.makeStore(root);
        expect(reopened.txTail.head()).toBe(2);
        expect(new StoreTxLog(reopened.txTail).head).toBe(2);

        yield* commit(reopened, upsert("n-c", "c"));
        expect(reopened.txTail.head()).toBe(3);
        expect(reopened.txTail.entries().map((tx) => tx.rev)).toEqual([1, 2, 3]);
      }),
    ),
  );
}

function sinceAfterReopen(adapter: LogAdapter): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const store = adapter.makeStore(root);
        yield* commit(store, upsert("n-a", "a"));
        yield* commit(store, upsert("n-b", "b"));

        const log = new StoreTxLog(adapter.makeStore(root).txTail);
        const caught = frames(log.since(1));
        expect(caught).toHaveLength(1);
        expect(caught[0]?.ops.upserts[0]?.id).toBe("n-b");
        expect(log.since(2)).toEqual([]);
        expect(frames(log.since(0))).toHaveLength(2);
      }),
    ),
  );
}

/** Assert a `since` answered with frames, and narrow it to them. */
function frames(answer: KbTx[] | "snapshot-required"): KbTx[] {
  expect(answer).not.toBe("snapshot-required");
  return answer === "snapshot-required" ? [] : answer;
}

function sinceBeyondHead(adapter: LogAdapter): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = adapter.makeStore(yield* scratchRoot);
        yield* commit(store, upsert("n-a", "a"));
        const log = new StoreTxLog(store.txTail);
        log.refresh();
        expect(log.head).toBe(1);
        expect(log.since(2)).toBe("snapshot-required");
      }),
    ),
  );
}

function emptyCommitRecordsNothing(adapter: LogAdapter): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = adapter.makeStore(yield* scratchRoot);
        yield* commit(store, { upserts: [], deletes: [] });
        expect(store.txTail.entries()).toEqual([]);
        expect(store.txTail.head()).toBe(0);
      }),
    ),
  );
}

function failedAppendKeepsHead(adapter: LogAdapter): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const store = adapter.makeStore(root);
        yield* commit(store, upsert("n-a", "a"));
        const log = new StoreTxLog(store.txTail);
        log.refresh();
        const before = log.head;

        // Head must not move for a record that was not written: a rev handed
        // out for a transaction nobody can read back is a hole in the sequence
        // that no reader can recover from.
        adapter.breakTail(root);
        expect(() => log.append(upsert("n-b", "b"), AT)).toThrow();
        expect(log.head).toBe(before);
        expect(store.txTail.head()).toBe(before);
      }),
    ),
  );
}

function storeAheadOfTailIsDetected(adapter: LogAdapter): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const store = adapter.makeStore(root);
        yield* commit(store, upsert("n-a", "a"));
        expect(store.txTail.isCurrent()).toBe(true);

        // The crash the write order is chosen for: the nodes landed and the
        // record did not.
        yield* commit(store, upsert("n-b", "b"));
        adapter.dropLastRecord(root);

        const reopened = adapter.makeStore(root);
        expect(reopened.txTail.head()).toBe(1);
        expect(reopened.txTail.isCurrent()).toBe(false);
        // …and the nodes really are ahead: nothing was rolled back but the log.
        expect((yield* reopened.loadEffect).map((n) => n.id)).toEqual(["n-a", "n-b"]);
      }),
    ),
  );
}

function staleTailForcesSnapshot(adapter: LogAdapter): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const store = adapter.makeStore(root);
        yield* commit(store, upsert("n-a", "a"));
        yield* commit(store, upsert("n-b", "b"));
        adapter.dropLastRecord(root);

        // A client that reconnects holding rev 1 is holding a graph without
        // `n-b`, and no frame the tail has says so. Being *at* head is not
        // being current when head is behind the store.
        const log = new StoreTxLog(adapter.makeStore(root).txTail);
        expect(log.head).toBe(1);
        expect(log.since(1)).toBe("snapshot-required");
        expect(log.since(0)).toBe("snapshot-required");

        // The next real transaction re-anchors the tail to the store, and
        // frames from there on are servable again.
        const appended = log.append(upsert("n-c", "c"), AT, "virtual");
        expect(log.head).toBe(appended.rev);
        expect(log.since(appended.rev)).toEqual([]);
      }),
    ),
  );
}

function virtualTxIsRecorded(adapter: LogAdapter): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = adapter.makeStore(yield* scratchRoot);
        yield* commit(store, upsert("n-a", "a"));
        const log = new StoreTxLog(store.txTail);
        log.refresh();

        const seen: number[] = [];
        const off = log.subscribe((tx: KbTx) => seen.push(tx.rev));
        const tx = log.append(upsert("sys.query.v", "saved"), AT, "virtual");
        off();

        expect(tx.rev).toBe(2);
        expect(seen).toEqual([2]);
        expect(log.head).toBe(2);
        // Recorded, and the nodes are untouched: a virtual node reaches the
        // sequence without ever reaching the store.
        expect((yield* store.loadEffect).map((n) => n.id)).toEqual(["n-a"]);
        expect(store.txTail.isCurrent()).toBe(true);
      }),
    ),
  );
}

/**
 * Run the log contract against one adapter.
 *
 * @param name - adapter name, used as the describe label
 * @param adapter - see {@link LogAdapter}. `makeStore` is called more than
 *   once per root on purpose, since "a second instance over the same files" is
 *   how both an external writer and a restart are spelled in port terms
 */
export function logContract(name: string, adapter: LogAdapter): void {
  describe(`${name} — KbTxLog contract`, () => {
    for (const [title, property] of PROPERTIES) test(title, () => property(adapter));
  });
}
