/**
 * The move to view nodes as a store contract property: a store written before
 * view nodes (DESIGN.md → Kinds, roles and options → View nodes) is rewritten
 * to them when it is opened, on every backend, and the next open is a read
 * again. `storeContract` lists it with the rest; it is a file of its own only
 * because the contract's file is at its size cap.
 */
import { expect } from "bun:test";
import { Effect } from "effect";
import {
  LEGACY_PERSPECTIVE_TAG,
  LEGACY_VIEW_MODE_FIELD,
  SYSTEM_IDS,
  frameViewNodeId,
  present,
  viewOptionId,
  type KbNode,
  type PropValue,
} from "@kb/model";
import {
  CONTRACT_AT,
  backendRoot,
  openSession,
  stateOf,
  type StoreFactory,
} from "./store-session.ts";

const ref = (v: string): PropValue => ({ t: "ref", v });
const num = (v: number): PropValue => ({ t: "num", v });
const node = (id: string, over: Partial<KbNode>): KbNode => ({
  id,
  text: id,
  props: {},
  children: [],
  createdAt: CONTRACT_AT,
  updatedAt: CONTRACT_AT,
  ...over,
});

/** The retired option `lens.renderer` held the tree renderer under. */
const LEGACY_TREE = "sys.graph.renderer.tree";

/** The old shape, written over a seeded store: what the open must rewrite. */
function legacyShape(lensRenderer: KbNode): KbNode[] {
  return [
    node(LEGACY_PERSPECTIVE_TAG, { props: { [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.tag)] } }),
    node(LEGACY_TREE, { text: "Tree" }),
    { ...lensRenderer, children: [LEGACY_TREE] },
    node("p.old", {
      props: {
        [SYSTEM_IDS.typeField]: [ref(LEGACY_PERSPECTIVE_TAG)],
        [SYSTEM_IDS.lensRendererField]: [ref(LEGACY_TREE)],
        [SYSTEM_IDS.lensMaxNodesField]: [num(40)],
      },
    }),
    node(LEGACY_VIEW_MODE_FIELD, { props: { [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.field)] } }),
    node("f.old", {
      props: {
        [LEGACY_VIEW_MODE_FIELD]: [{ t: "str", v: "table" }],
        [SYSTEM_IDS.viewPagesizeField]: [num(7)],
      },
    }),
  ];
}

export function openingMigratesToViewNodes(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* backendRoot(makeStore);
        yield* openSession(root);
        const store = makeStore(root);
        const lensRenderer = present(
          (yield* store.loadEffect).find((n) => n.id === SYSTEM_IDS.lensRendererField),
          "the seeded lens.renderer field",
        );
        yield* store.commitEffect(
          { upserts: legacyShape(lensRenderer), deletes: [] },
          { at: CONTRACT_AT },
        );

        yield* openSession(root);
        const migrated = new Map((yield* store.loadEffect).map((n) => [n.id, n]));
        expect(migrated.has(LEGACY_PERSPECTIVE_TAG)).toBe(false);
        expect(migrated.has(LEGACY_TREE)).toBe(false);
        expect(migrated.get(SYSTEM_IDS.lensRendererField)?.children).toEqual([]);
        expect(migrated.get("p.old")?.props).toEqual({
          [SYSTEM_IDS.viewField]: [ref(viewOptionId("graph.tree"))],
          [SYSTEM_IDS.lensMaxNodesField]: [num(40)],
        });
        const frameView = frameViewNodeId("f.old");
        expect(migrated.has(LEGACY_VIEW_MODE_FIELD)).toBe(false);
        expect(migrated.get("f.old")?.props).toEqual({
          [SYSTEM_IDS.viewsField]: [ref(frameView)],
        });
        expect(migrated.get(frameView)?.props).toEqual({
          [SYSTEM_IDS.viewField]: [ref(viewOptionId("outline.table"))],
          [SYSTEM_IDS.viewPagesizeField]: [num(7)],
        });
        expect(migrated.get(SYSTEM_IDS.viewsList)?.children).toContain(frameView);

        const settled = yield* stateOf(makeStore(root));
        yield* openSession(root);
        expect(yield* stateOf(makeStore(root))).toEqual(settled);
      }),
    ),
  );
}
