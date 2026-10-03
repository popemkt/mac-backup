/**
 * Opening as a store contract property: a session opened over any backend is
 * a read, whatever the store held before — a fresh seed, a store an earlier
 * kb seeded, or a family's nodes this kb no longer folds (DESIGN.md →
 * Extension families → the seed is the bundled fold). `storeContract` lists
 * these with the rest; they are a file of their own only because the
 * contract's file is at its size cap.
 */
import { expect } from "bun:test";
import { Effect } from "effect";
import { SYSTEM_IDS, fieldTypeValue, type KbNode } from "@kb/model";
import { seedGoldenNodes } from "./seed-golden.ts";
import {
  CONTRACT_AT,
  backendRoot,
  openSession,
  stateOf,
  type StoreFactory,
} from "./store-session.ts";

const AT = CONTRACT_AT;

function plainNode(id: string, text: string): KbNode {
  return { id, text, props: {}, children: [], createdAt: AT, updatedAt: AT };
}

/**
 * Open the store at `root` twice and expect neither open to write: its nodes,
 * its fingerprint and its tail stay as they were. The opening properties
 * below differ only in what the store held before.
 */
const opensWithoutWriting = Effect.fn("storeContract.opensWithoutWriting")(function* (
  makeStore: StoreFactory,
  root: string,
) {
  const before = yield* stateOf(makeStore(root));
  yield* openSession(root);
  yield* openSession(root);
  expect(yield* stateOf(makeStore(root))).toEqual(before);
});

export function openingNeverWrites(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* backendRoot(makeStore);
        // The first open seeds a new store: a real migration, so it writes.
        yield* openSession(root);
        expect((yield* stateOf(makeStore(root))).tail).toBeGreaterThan(0);
        yield* opensWithoutWriting(makeStore, root);
      }),
    ),
  );
}

/**
 * A store seeded by an earlier kb — the seed golden, written as that kb's
 * first open wrote it — opens without a write: the seed's owners may move
 * between packages, but its ids and nodes do not (DESIGN.md → Extension
 * families → Ids are frozen data).
 */
export function goldenSeedOpensUnwritten(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* backendRoot(makeStore);
        yield* makeStore(root).commitEffect(
          { upserts: seedGoldenNodes(), deletes: [] },
          { at: AT },
        );
        yield* opensWithoutWriting(makeStore, root);
      }),
    ),
  );
}

/**
 * A store whose `sys.views` options an earlier kb listed in another order —
 * any store seeded before the fold put core's view types first — opens
 * without a write and keeps its order: the seed only appends an option a
 * store lacks, so a fresh store's order never reaches an existing one.
 */
export function viewTypeOrderSurvivesOpening(makeStore: StoreFactory): Promise<void> {
  const nodes = seedGoldenNodes().map((node) =>
    node.id === SYSTEM_IDS.viewsRoot ? { ...node, children: node.children.toReversed() } : node,
  );
  const earlier = nodes.find((node) => node.id === SYSTEM_IDS.viewsRoot)?.children;
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* backendRoot(makeStore);
        yield* makeStore(root).commitEffect({ upserts: nodes, deletes: [] }, { at: AT });
        yield* opensWithoutWriting(makeStore, root);
        const loaded = yield* makeStore(root).loadEffect;
        expect(loaded.find((node) => node.id === SYSTEM_IDS.viewsRoot)?.children).toEqual(earlier);
      }),
    ),
  );
}

/**
 * A store holding a family's seed that this kb does not fold — an extension
 * switched off or gone — keeps those nodes as they are: opening neither
 * deletes nor rewrites a view option or a field no seed declares. The data
 * outlives the code.
 */
export function unfoldedSeedNodesSurviveOpening(makeStore: StoreFactory): Promise<void> {
  const retiredView = "sys.view.retired.page";
  const retiredField = "sys.f.retired";
  const nodes = seedGoldenNodes().map((node) =>
    node.id === SYSTEM_IDS.viewsRoot
      ? { ...node, children: [...node.children, retiredView] }
      : node,
  );
  const unfolded: KbNode[] = [
    plainNode(retiredView, "Retired"),
    {
      ...plainNode(retiredField, "retired"),
      props: {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
        [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("text")],
      },
    },
  ];
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* backendRoot(makeStore);
        yield* makeStore(root).commitEffect(
          { upserts: [...nodes, ...unfolded], deletes: [] },
          { at: AT },
        );
        yield* opensWithoutWriting(makeStore, root);
        const loaded = new Map((yield* makeStore(root).loadEffect).map((node) => [node.id, node]));
        expect(loaded.get(SYSTEM_IDS.viewsRoot)?.children.at(-1)).toBe(retiredView);
        expect(loaded.get(retiredField)?.text).toBe("retired");
      }),
    ),
  );
}
