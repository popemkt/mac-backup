/**
 * The store contract: what every {@link EffectStore} adapter must do, written
 * once and run against each of them.
 *
 * A port with one implementation is an assumption wearing an interface — the
 * properties below are the difference between "JSONL happens to behave this
 * way" and "this is what the store promises". Each adapter's test file calls
 * {@link storeContract} with its own factory; anything an adapter does that is
 * not in here (a lock file, `.bak` rotation, line-numbered decode errors) is
 * that adapter's own test, because it is not a store property.
 *
 * Every property runs against a fresh scratch root released by the scope that
 * acquired it, so nothing here can see the owner's live store.
 *
 * Two layers of promise live here, both run over every adapter. The port's
 * own (load, commit, fingerprint, and the ranks a commit settles — DESIGN.md
 * → Sibling ranks), and what a *session* over the port promises because of
 * them: opening is a read, and a node created without a rank gets one from
 * the one owner and keeps it. A session guarantee that held on JSONL alone
 * would be a JSONL property, so those are written against the port too — the
 * session is opened on whichever store the factory made, by presence, the way
 * every surface opens one.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { Cause, Duration, Effect, Exit, Option, Queue, Stream } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STORE_CHANGES_POLL, type EffectStore, type KbContext } from "@kb/contracts";
import {
  applyTx,
  canonicalJsonl,
  compareRootOrder,
  isDomainError,
  present,
  rankOf,
  rankTx,
  type DomainError,
  type KbNode,
  type PropValue,
} from "@kb/model";
import { bunFileSystemLayer, invokeReceiptEffect, kbRuntimeLayer, openKbEffect } from "@kb/runtime";

/** How the suite gets an adapter under test for a scratch root. */
export type StoreFactory = (root: string) => EffectStore;

const AT = "2026-01-01T00:00:00.000Z";

const propValueArb: fc.Arbitrary<PropValue> = fc.oneof(
  fc.record({ t: fc.constant("str" as const), v: fc.string() }),
  fc.record({
    t: fc.constant("num" as const),
    // JSON has no negative-zero literal — `JSON.stringify(-0) === "0"` — so
    // it is excluded for the same reason as NaN/Infinity: not representable.
    v: fc
      .double({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 })
      .filter((n) => !Object.is(n, -0)),
  }),
  fc.record({ t: fc.constant("bool" as const), v: fc.boolean() }),
  fc.record({ t: fc.constant("date" as const), v: fc.string() }),
  fc.record({ t: fc.constant("ref" as const), v: fc.string() }),
);

/**
 * A KbNode plus a chance of an unknown top-level key, matching real drift
 * (a field the store must have kept even before this loader knew its shape).
 */
const nodeArb = fc
  .record({
    id: fc.stringMatching(/^n[a-z0-9-]{1,12}$/),
    text: fc.string(),
    props: fc.dictionary(
      // Real field ids are ULIDs or `sys.*` identifiers, never a magic own
      // property name — `__proto__` on a plain `{}` sets the prototype
      // instead of an own key, which is a JS object-literal footgun, not a
      // store bug (canonicalJson defends against it too; see storage fix).
      fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s !== "__proto__"),
      fc.array(propValueArb, { minLength: 0, maxLength: 3 }),
    ),
    children: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 4 }),
    // A rank is present or absent, never present-and-empty: `KbNodeSchema`
    // rejects `""`, so the contract's arbitrary must not mint it either.
    order: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
    extra: fc.option(fc.string(), { nil: undefined }),
  })
  .map(({ id, text, props, children, order, extra }) => {
    const node: KbNode & { legacyField?: string } = {
      id,
      text,
      props,
      children,
      createdAt: AT,
      updatedAt: AT,
    };
    if (order !== undefined) node.order = order;
    if (extra !== undefined) node.legacyField = extra;
    return node;
  });

function plainNode(id: string, text: string): KbNode {
  return { id, text, props: {}, children: [], createdAt: AT, updatedAt: AT };
}

/** A scratch root for the current scope, removed when the scope closes. */
const scratchRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "kb-store-contract-"))),
  (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
);

/** The DomainError a failed Exit carries, or the raw defect when it is not one. */
function failureOf(exit: Exit.Exit<unknown, DomainError>): unknown {
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
}

/**
 * One round-trip check, lifted out of the property so the assertion body is
 * not four callbacks deep inside `describe` → `test` → `asyncProperty`.
 */
function roundTripHolds(makeStore: StoreFactory, nodes: KbNode[]): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = makeStore(yield* scratchRoot);
        yield* store.commitEffect({ upserts: nodes, deletes: [] }, { at: AT });
        const loaded = yield* store.loadEffect;

        expect(loaded.map((n) => n.id)).toEqual(nodes.map((n) => n.id).toSorted());

        // What was written, as the commit settles it: the model says which
        // ranks a commit repairs, and nothing else about a node may change.
        const settled = applyTx([], rankTx([], { upserts: nodes, deletes: [] }));
        const byId = new Map(settled);
        for (const loadedNode of loaded) {
          expect(loadedNode).toEqual(
            present(byId.get(loadedNode.id), "expected byId.get(loadedNode.id)"),
          );
        }
      }),
    ),
  );
}

/**
 * Every property, as a named check over a factory. A list rather than a body
 * of `test` calls so each property is a function you can read on its own, and
 * so the registration below stays the two lines it is.
 */
const PROPERTIES: ReadonlyArray<readonly [string, (makeStore: StoreFactory) => Promise<void>]> = [
  [
    "an unwritten store loads empty, and whatever fingerprint it names is stable",
    unwrittenStoreIsEmpty,
  ],
  [
    "write then read: identical nodes apart from the ranks the commit settles, no key dropped",
    roundTripsAnyNodeSet,
  ],
  [
    "a node committed without a rank gets one, and reloading returns it unchanged",
    unrankedNodeIsRanked,
  ],
  [
    "two writers appending from one read never leave siblings sharing a rank",
    concurrentAppendsGetDistinctRanks,
  ],
  ["a commit touches only the nodes that changed", commitTouchesOnlyChanges],
  [
    "opening is a read: reopening leaves the nodes, the fingerprint and the tail as they were",
    openingNeverWrites,
  ],
  [
    "a node created without a rank gets one from the one owner, and a reopen keeps it",
    createdNodeKeepsItsRank,
  ],
  ["an opening migration commits exactly the nodes it changed", openingMigrationIsMinimal],
  ["a commit merges into what is there: upserts overwrite, deletes remove", commitMerges],
  ["the fingerprint is stable across loads and moves when the content does", fingerprintTracks],
  ["another writer's commit is visible, and changes this store's fingerprint", externalWriteIsSeen],
  ["every instance over one root gives one state one name", instancesAgreeOnTheName],
  [
    "changes: the state once armed, then another writer's commit, unasked and without repeats",
    externalCommitIsAnnounced,
  ],
  [
    "concurrent commits are serialized: neither writer's nodes are lost",
    concurrentCommitsSerialize,
  ],
  [
    "a conditional commit lands only on the state it names, and a stale one leaves no trace",
    conditionalCommitNamesItsBase,
  ],
  ["two conditional commits from one state: at most one lands", conditionalCommitsRace],
  [
    "a commit that cannot be written fails with a DomainError and leaves no store",
    unwritableCommitFails,
  ],
];

function unwrittenStoreIsEmpty(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = makeStore(yield* scratchRoot);
        expect(yield* store.loadEffect).toEqual([]);
        // Null ("cannot say") and a content-derived name for the empty store
        // are both honest; flickering between reads is not.
        expect(yield* store.fingerprint).toBe(yield* store.fingerprint);
      }),
    ),
  );
}

function roundTripsAnyNodeSet(makeStore: StoreFactory): Promise<void> {
  return fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(nodeArb, { selector: (n) => n.id, minLength: 0, maxLength: 15 }),
      (nodes) => roundTripHolds(makeStore, nodes),
    ),
    { numRuns: 100 },
  );
}

function commitMerges(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = makeStore(yield* scratchRoot);
        yield* store.commitEffect(
          {
            upserts: [plainNode("n-a", "a"), plainNode("n-b", "b"), plainNode("n-c", "c")],
            deletes: [],
          },
          { at: AT },
        );
        yield* store.commitEffect(
          { upserts: [plainNode("n-b", "b2")], deletes: ["n-a"] },
          { at: AT },
        );

        const loaded = yield* store.loadEffect;
        expect(loaded.map((n) => n.id)).toEqual(["n-b", "n-c"]);
        expect(loaded.map((n) => n.text)).toEqual(["b2", "c"]);
      }),
    ),
  );
}

function fingerprintTracks(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = makeStore(yield* scratchRoot);
        yield* store.commitEffect({ upserts: [plainNode("n-a", "a")], deletes: [] }, { at: AT });

        const first = yield* store.fingerprint;
        expect(first).not.toBeNull();
        yield* store.loadEffect;
        yield* store.loadEffect;
        expect(yield* store.fingerprint).toBe(first);

        yield* store.commitEffect({ upserts: [plainNode("n-b", "b")], deletes: [] }, { at: AT });
        expect(yield* store.fingerprint).not.toBe(first);
      }),
    ),
  );
}

function externalWriteIsSeen(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const store = makeStore(root);
        yield* store.commitEffect({ upserts: [plainNode("n-a", "a")], deletes: [] }, { at: AT });
        const before = yield* store.fingerprint;

        const external = makeStore(root);
        yield* external.commitEffect({ upserts: [plainNode("n-b", "b")], deletes: [] }, { at: AT });

        expect(yield* store.fingerprint).not.toBe(before);
        expect((yield* store.loadEffect).map((n) => n.id)).toEqual(["n-a", "n-b"]);
      }),
    ),
  );
}

function instancesAgreeOnTheName(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const one = makeStore(root);
        yield* one.commitEffect({ upserts: [plainNode("n-a", "a")], deletes: [] }, { at: AT });
        const two = makeStore(root);
        yield* two.loadEffect;
        expect(yield* two.fingerprint).toBe(yield* one.fingerprint);

        // The name is the state's, not the reader's: a fingerprint read
        // through one instance is a condition another instance can commit on.
        const seen = present(yield* two.fingerprint, "expected a written store to name itself");
        const landed = yield* one.commitEffect(
          { upserts: [plainNode("n-b", "b")], deletes: [] },
          { at: AT },
          seen,
        );
        expect(landed.base).toBe(seen);
        expect(yield* two.fingerprint).toBe(landed.fingerprint);
      }),
    ),
  );
}

/**
 * How long a commit may take to reach another instance's `changes`: the
 * port's poll bound, with slack for a loaded machine. The property is "live
 * without being asked", not "fast".
 */
const CHANGE_WITHIN = Duration.times(STORE_CHANGES_POLL, 3);

function externalCommitIsAnnounced(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const one = makeStore(root);
        yield* one.commitEffect({ upserts: [plainNode("n-a", "a")], deletes: [] }, { at: AT });

        const announced: Array<string | null> = [];
        const queue = yield* Queue.unbounded<string | null>();
        yield* Stream.runForEach(one.changes, (fingerprint) =>
          Effect.sync(() => {
            announced.push(fingerprint);
            Queue.offerUnsafe(queue, fingerprint);
          }),
        ).pipe(Effect.forkScoped);
        const next = Queue.take(queue).pipe(
          Effect.timeoutOption(CHANGE_WITHIN),
          Effect.map(Option.getOrUndefined),
        );

        // Armed: the first element is the state as it is, so what follows is news.
        expect(yield* next).toBe(yield* one.fingerprint);

        // A second instance over the same root is how another process is
        // spelled in port terms. Two commits, because the second is the one a
        // watch left on the file the first replaced would miss.
        const two = makeStore(root);
        for (const id of ["n-b", "n-c"]) {
          const landed = yield* two.commitEffect(
            { upserts: [plainNode(id, id)], deletes: [] },
            { at: AT },
          );
          expect(yield* next).toBe(landed.fingerprint);
        }

        // One state is announced once, however many platform events it took.
        for (const [i, fingerprint] of announced.entries()) {
          if (i > 0) expect(fingerprint).not.toBe(announced[i - 1]);
        }
      }),
    ),
  );
}

function concurrentCommitsSerialize(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const one = makeStore(root);
        const two = makeStore(root);
        yield* one.commitEffect({ upserts: [plainNode("n-a", "a")], deletes: [] }, { at: AT });

        const exits = yield* Effect.all(
          [
            Effect.exit(
              one.commitEffect({ upserts: [plainNode("n-b", "b")], deletes: [] }, { at: AT }),
            ),
            Effect.exit(
              two.commitEffect({ upserts: [plainNode("n-c", "c")], deletes: [] }, { at: AT }),
            ),
          ],
          { concurrency: "unbounded" },
        );

        // A loser is allowed — silent loss is not. Whoever succeeded is on
        // disk, and whoever failed said so as a DomainError, not a defect.
        const ids = ["n-b", "n-c"];
        const landed = new Set(["n-a"]);
        for (const [i, exit] of exits.entries()) {
          if (Exit.isSuccess(exit)) landed.add(present(ids[i], "expected commit id"));
          else expect(isDomainError(failureOf(exit))).toBe(true);
        }

        expect((yield* one.loadEffect).map((n) => n.id)).toEqual([...landed].toSorted());
      }),
    ),
  );
}

function conditionalCommitNamesItsBase(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const store = makeStore(root);
        yield* store.commitEffect({ upserts: [plainNode("n-a", "a")], deletes: [] }, { at: AT });
        const seen = present(yield* store.fingerprint, "expected a written store to name itself");

        const landed = yield* store.commitEffect(
          { upserts: [plainNode("n-b", "b")], deletes: [] },
          { at: AT },
          seen,
        );
        expect(landed.base).toBe(seen);

        // `seen` is gone now: the same condition must fail, write no node and
        // record no tx.
        const entries = store.txTail.entries().length;
        const exit = yield* Effect.exit(
          store.commitEffect(
            { upserts: [plainNode("n-c", "c")], deletes: ["n-a"] },
            { at: AT },
            seen,
          ),
        );
        const failure = failureOf(exit);
        expect(isDomainError(failure) && failure.code).toBe("conflict");
        expect((yield* makeStore(root).loadEffect).map((n) => n.id)).toEqual(["n-a", "n-b"]);
        expect(store.txTail.entries()).toHaveLength(entries);
      }),
    ),
  );
}

function conditionalCommitsRace(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const one = makeStore(root);
        const two = makeStore(root);
        yield* one.commitEffect({ upserts: [plainNode("n-a", "a")], deletes: [] }, { at: AT });
        const seen = present(yield* one.fingerprint, "expected a written store to name itself");

        const exits = yield* Effect.all(
          [
            Effect.exit(
              one.commitEffect({ upserts: [plainNode("n-b", "b")], deletes: [] }, { at: AT }, seen),
            ),
            Effect.exit(
              two.commitEffect({ upserts: [plainNode("n-c", "c")], deletes: [] }, { at: AT }, seen),
            ),
          ],
          { concurrency: "unbounded" },
        );

        // Both decided on `seen`; at most one may act on it. (Zero is allowed:
        // a writer that times out on the other's lock also said so.)
        expect(exits.filter(Exit.isSuccess).length).toBeLessThanOrEqual(1);
        for (const exit of exits.filter(Exit.isFailure)) {
          expect(isDomainError(failureOf(exit))).toBe(true);
        }
        expect((yield* one.loadEffect).length).toBe(1 + exits.filter(Exit.isSuccess).length);
      }),
    ),
  );
}

function unwritableCommitFails(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        // A regular file where the store wants a directory: the write fails at
        // the platform, which is the one failure every backend shares.
        const blocked = join(yield* scratchRoot, "not-a-directory");
        yield* Effect.promise(() => writeFile(blocked, ""));
        const store = makeStore(blocked);

        const exit = yield* Effect.exit(
          store.commitEffect({ upserts: [plainNode("n-a", "a")], deletes: [] }, { at: AT }),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        expect(isDomainError(failureOf(exit))).toBe(true);
        expect(yield* store.fingerprint).toBeNull();
      }),
    ),
  );
}

/** Roots in visible order, and whether any two share a rank. */
function rootRanks(nodes: readonly KbNode[]): { ranks: string[]; distinct: boolean } {
  const children = new Set(nodes.flatMap((n) => n.children));
  const ranks = nodes
    .filter((n) => !children.has(n.id))
    .toSorted(compareRootOrder)
    .map((n) => {
      const rank = rankOf(n);
      return rank.ranked ? rank.order : "";
    });
  return { ranks, distinct: new Set(ranks).size === ranks.length && !ranks.includes("") };
}

function unrankedNodeIsRanked(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const store = makeStore(root);
        const parent = { ...plainNode("n-p", "p"), children: ["n-c1", "n-c2"] };
        const commit = yield* store.commitEffect(
          {
            upserts: [
              parent,
              plainNode("n-c1", "c1"),
              plainNode("n-c2", "c2"),
              plainNode("n-r", "r"),
            ],
            deletes: [],
          },
          { at: AT },
        );
        const loaded = yield* store.loadEffect;
        for (const node of loaded) expect(rankOf(node).ranked).toBe(true);
        const byId = new Map(loaded.map((n) => [n.id, n]));
        const [c1, c2] = [byId.get("n-c1")?.order ?? "", byId.get("n-c2")?.order ?? ""];
        expect(c1 < c2).toBe(true);
        // The commit reports the ranks it settled: they are what the store holds.
        expect(commit.tx.upserts.toSorted((a, b) => (a.id < b.id ? -1 : 1))).toEqual(loaded);

        const fingerprint = yield* store.fingerprint;
        expect(yield* makeStore(root).loadEffect).toEqual(loaded);
        expect(yield* store.fingerprint).toBe(fingerprint);
      }),
    ),
  );
}

function concurrentAppendsGetDistinctRanks(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const one = makeStore(root);
        const two = makeStore(root);
        yield* one.commitEffect(
          { upserts: [{ ...plainNode("n-a", "a"), order: "i" }], deletes: [] },
          { at: AT },
        );
        // Both writers read the same tail and derived the same next rank.
        const append = (id: string) => ({ ...plainNode(id, id), order: "j" });
        const exits = yield* Effect.all(
          [
            Effect.exit(one.commitEffect({ upserts: [append("n-b")], deletes: [] }, { at: AT })),
            Effect.exit(two.commitEffect({ upserts: [append("n-c")], deletes: [] }, { at: AT })),
          ],
          { concurrency: "unbounded" },
        );
        for (const exit of exits.filter(Exit.isFailure)) {
          expect(isDomainError(failureOf(exit))).toBe(true);
        }
        // And one after the other, so the property never rests on a lost race.
        yield* two.commitEffect({ upserts: [append("n-d")], deletes: [] }, { at: AT });

        const loaded = yield* one.loadEffect;
        const { ranks, distinct } = rootRanks(loaded);
        expect(ranks.length).toBe(2 + exits.filter(Exit.isSuccess).length);
        expect(distinct).toBe(true);
      }),
    ),
  );
}

function commitTouchesOnlyChanges(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = makeStore(yield* scratchRoot);
        const [a, b] = [
          { ...plainNode("n-a", "a"), order: "i" },
          { ...plainNode("n-b", "b"), order: "m" },
        ];
        yield* store.commitEffect({ upserts: [a, b], deletes: [] }, { at: AT });
        const commit = yield* store.commitEffect(
          { upserts: [{ ...b, text: "b2" }], deletes: [] },
          { at: AT },
        );
        expect(commit.tx.upserts.map((n) => n.id)).toEqual(["n-b"]);
        expect(
          store.txTail
            .entries()
            .at(-1)
            ?.ops.upserts.map((n) => n.id),
        ).toEqual(["n-b"]);
      }),
    ),
  );
}

/** Open a session the way every surface does: select by presence, seed if new. */
function openSession(root: string): Effect.Effect<KbContext, DomainError> {
  return openKbEffect(root).pipe(Effect.provide(bunFileSystemLayer));
}

/** A root the factory's backend owns, so opening it selects that backend. */
const backendRoot = Effect.fn("storeContract.backendRoot")(function* (makeStore: StoreFactory) {
  const root = yield* scratchRoot;
  yield* makeStore(root).commitEffect({ upserts: [], deletes: [] }, { at: AT });
  return root;
});

interface StoreState {
  readonly nodes: string;
  readonly fingerprint: string | null;
  readonly tail: number;
}

const stateOf = Effect.fn("storeContract.stateOf")(function* (store: EffectStore) {
  const state: StoreState = {
    nodes: canonicalJsonl(yield* store.loadEffect),
    fingerprint: yield* store.fingerprint,
    tail: store.txTail.entries().length,
  };
  return state;
});

function openingNeverWrites(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* backendRoot(makeStore);
        // The first open seeds a new store: a real migration, so it writes.
        yield* openSession(root);
        const seeded = yield* stateOf(makeStore(root));
        expect(seeded.tail).toBeGreaterThan(0);

        yield* openSession(root);
        yield* openSession(root);
        expect(yield* stateOf(makeStore(root))).toEqual(seeded);
      }),
    ),
  );
}

function createdNodeKeepsItsRank(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* backendRoot(makeStore);
        const ctx = yield* openSession(root);
        for (const text of ["first", "second"]) {
          const receipt = yield* invokeReceiptEffect(ctx, {
            id: "node.add",
            input: { text },
          }).pipe(Effect.provide(kbRuntimeLayer(ctx)));
          expect(receipt.status).toBe("succeeded");
        }
        const written = yield* stateOf(makeStore(root));
        const loaded = yield* makeStore(root).loadEffect;
        const added = loaded.filter((n) => n.text === "first" || n.text === "second");
        expect(added.map((n) => rankOf(n).ranked)).toEqual([true, true]);
        // Appended in order, so ranked in order: the second after the first.
        const [first, second] = ["first", "second"].map(
          (text) => added.find((n) => n.text === text)?.order ?? "",
        );
        expect((first ?? "") < (second ?? "")).toBe(true);
        expect(rootRanks(loaded).distinct).toBe(true);

        yield* openSession(root);
        expect(yield* stateOf(makeStore(root))).toEqual(written);
      }),
    ),
  );
}

function openingMigrationIsMinimal(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* backendRoot(makeStore);
        yield* openSession(root);
        const store = makeStore(root);
        // A store seeded before one declaration existed: drop a seeded prop,
        // which the seed's fill-absent pass restores on the next open.
        const seeded = present(
          (yield* store.loadEffect).find(
            (n) => n.id.startsWith("sys.") && Object.keys(n.props).length > 0,
          ),
          "expected a seeded node with props",
        );
        const [dropped] = Object.keys(seeded.props);
        const { [present(dropped, "a prop key")]: _gone, ...kept } = seeded.props;
        yield* store.commitEffect(
          { upserts: [{ ...seeded, props: kept }], deletes: [] },
          { at: AT },
        );
        const before = store.txTail.entries().length;

        yield* openSession(root);
        const entries = makeStore(root).txTail.entries();
        expect(entries).toHaveLength(before + 1);
        expect(entries.at(-1)?.ops.upserts.map((n) => n.id)).toEqual([seeded.id]);
        expect(entries.at(-1)?.ops.deletes).toEqual([]);
      }),
    ),
  );
}

/**
 * Run the contract against one adapter.
 *
 * @param name - adapter name, used as the describe label
 * @param makeStore - build the adapter for a scratch root; called more than
 *   once per root on purpose, since "a second instance over the same files" is
 *   how an external writer is spelled in port terms
 */
export function storeContract(name: string, makeStore: StoreFactory): void {
  describe(`${name} — EffectStore contract`, () => {
    for (const [title, property] of PROPERTIES) test(title, () => property(makeStore));
  });
}
