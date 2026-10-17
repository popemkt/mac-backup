/**
 * Opening a root: the one way every surface gets a session over a root's
 * store. Its own module so that what needs a session over another root (the
 * runtime's `KbRoots` adapter) and the runtime layer over this one both build
 * on it without importing each other.
 */
import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import {
  currentIso,
  applyTx,
  diffTx,
  ensureSystemSeed,
  migrateDateValues,
  migrateFieldTypeValues,
  legacyViewShapes,
  type DomainError,
  type KbNode,
} from "@kb/model";
import { bundledDerived, bundledSeed } from "@kb/bundled";
import { DatascriptIndex } from "@kb/query";
import { KbStore, type KbContext } from "@kb/contracts";
import { StoreTxLog } from "@kb/tx-log";
import { readLegacyDocsViews } from "@kb/workspace-fs";
import { noteStoreSynced } from "@kb/operations";
import { selectStore } from "./store-selection.ts";

/**
 * Warn, and only warn, that a store or its root still holds what came before
 * view nodes: the shapes `views.migrate` rewrites and the spec files it
 * imports.
 */
const reportLegacyViews = Effect.fn("kb.open.legacyViews")(function* (
  root: string,
  nodes: KbNode[],
) {
  const files = yield* readLegacyDocsViews(root);
  const held = [
    ...legacyViewShapes(nodes),
    ...(files.views.length > 0
      ? [`.kb/views spec(s) ${files.views.map((view) => view.name).join(", ")}`]
      : []),
    ...files.skipped,
  ];
  if (held.length > 0)
    yield* Effect.logWarning(
      `kb: ${root} holds shapes from before view nodes; run the views.migrate action: ${held.join("; ")}`,
    );
});

/**
 * Open a session over the root's store.
 *
 * Opening is a read. It writes only when a real migration runs — the
 * system seed adds or retires nodes, a field-type value or a legacy date
 * value is rewritten — and then it
 * commits exactly the nodes that migration changed, never the whole set. Ranks
 * are not a migration: a node without one is ordered by `compareRootOrder`
 * in memory and ranked by the store on the next commit that writes its
 * sibling group (DESIGN.md → Sibling ranks), so reopening a store leaves its
 * bytes, its fingerprint and its tail alone.
 *
 * A store written before view nodes, or a root still keeping `.kb/views`
 * specs, is not rewritten here: that is `views.migrate`, an action a person
 * or agent runs. Opening says so, as a warning in the log.
 */
export const openKbEffect = Effect.fn("kb.open")(function* (
  root: string,
): Effect.fn.Return<KbContext, DomainError, FileSystem> {
  const store = yield* selectStore(root);
  const loaded = yield* store.loadEffect;
  const at = yield* currentIso;
  const { nodes: seeded, seeded: didSeed, deletes } = ensureSystemSeed(loaded, bundledSeed(at));
  const typed = migrateFieldTypeValues(seeded);
  const dated = migrateDateValues(typed.nodes);
  let nodes = loaded;
  if (didSeed || deletes.length > 0 || typed.changed || dated.changed) {
    const commit = yield* store.commitEffect(diffTx(loaded, dated.nodes), { at });
    nodes = [...applyTx(loaded, commit.tx).values()];
  }
  yield* reportLegacyViews(root, nodes);
  const index = new DatascriptIndex(nodes, { derived: bundledDerived() });
  const ctx: KbContext = {
    root,
    store,
    index,
    log: new StoreTxLog(store.txTail),
    get nodes(): KbNode[] {
      return index.storedNodes();
    },
  };
  yield* noteStoreSynced(ctx).pipe(Effect.provideService(KbStore, store));
  return ctx;
});
