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
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { Cause, Duration, Effect, Exit, Option, Queue, Stream } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STORE_CHANGES_POLL, type EffectStore } from "@kb/contracts";
import { isDomainError, present, type DomainError, type KbNode, type PropValue } from "@kb/model";

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

        const byId = new Map(nodes.map((n) => [n.id, n]));
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
    "write then read: identical nodes, identical order, no key invented or dropped",
    roundTripsAnyNodeSet,
  ],
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
