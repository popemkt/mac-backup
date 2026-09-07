import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { SavedQueries, VIRTUAL_ORIGIN, type KbContext, type SavedQuery } from "@kb/contracts";
import { savedQueriesLayer } from "@kb/workspace-fs";
import { bunFileSystemLayer } from "@kb/store-jsonl";
import { SYSTEM_IDS, diffTx, type KbNode } from "@kb/model";

/**
 * `GET /api/queries` and the virtual query nodes both want the same thing —
 * every saved query, by name — and the {@link SavedQueries} port already
 * answers it. This binds the port to `root` and keeps the surface's promise
 * that a platform failure is a defect (HTTP `catchCause` maps it to 500),
 * which is why the port's DomainError channel dies here rather than widening
 * the callers' error type.
 */
export function listSavedQueriesEffect(
  root: string,
): Effect.Effect<readonly SavedQuery[], never, FileSystem> {
  return Effect.gen(function* () {
    const queries = yield* SavedQueries;
    return yield* queries.list;
  }).pipe(Effect.orDie, Effect.provide(savedQueriesLayer(root)));
}

export function listSavedQueries(root: string): Promise<readonly SavedQuery[]> {
  return Effect.runPromise(listSavedQueriesEffect(root).pipe(Effect.provide(bunFileSystemLayer)));
}

/** Stable timestamp keeps virtual nodes out of the content-hash noise. */
const SAVED_QUERY_ISO = "1970-01-01T00:00:00.000Z";

/**
 * Saved queries (.kb/queries/*.edn) surfaced as query nodes under a
 * `sys.queries` root (DESIGN-REFINE §2 W4). Materialized at load into the
 * UI graph only — never duplicated into .kb/nodes.jsonl.
 */
export function savedQueryNodes(saved: readonly SavedQuery[]): KbNode[] {
  if (saved.length === 0) return [];
  const mk = (id: string, text: string, props: KbNode["props"]): KbNode => ({
    id,
    text,
    props,
    children: [],
    createdAt: SAVED_QUERY_ISO,
    updatedAt: SAVED_QUERY_ISO,
  });
  const queries = saved.map((q) =>
    mk(`sys.query.${q.name}`, q.name, {
      [SYSTEM_IDS.queryField]: [{ t: "str", v: q.edn.trim() }],
    }),
  );
  const root = mk(SYSTEM_IDS.queriesRoot, "Saved queries", {});
  root.children = queries.map((q) => q.id);
  return [root, ...queries];
}

/**
 * The saved-query virtual set, as a logged transaction.
 *
 * The set is index-only: those nodes answer queries, reach clients in the
 * snapshot, and never reach the store. That used to mean they never reached
 * the *log* either — the hub was handed them once at construction and forgot
 * them — so a client catching up with `since` ended holding a graph a fresh
 * snapshot disagreed with, and a saved query added, renamed or removed while
 * it was behind stayed wrong until something happened to make it refetch
 * (GAP `01M1QZNBFSTCM9V7DZT1XWEY2N`).
 *
 * So this owns the set and the log records its changes like any other
 * transaction, carrying {@link VIRTUAL_ORIGIN}. One path to a client, whatever
 * a node's provenance.
 *
 * {@link adopt} and {@link sync} are the same pair the index has in `rebuild`
 * and `applyTx`, and for the same reason: the first set is what the snapshot
 * carries, so logging it would spend a rev telling every client something its
 * snapshot already said.
 */
export class SavedQuerySet {
  private readonly ctx: KbContext;
  private current: KbNode[] = [];

  constructor(ctx: KbContext) {
    this.ctx = ctx;
  }

  /** Install the initial set. Not logged: the snapshot is taken after it. */
  adopt(nodes: readonly KbNode[]): void {
    this.current = [...nodes];
    if (nodes.length > 0) this.ctx.index.withVirtual(this.current);
  }

  /** Adopt `nodes` and record the difference. A no-op when nothing moved. */
  sync(nodes: readonly KbNode[], at: string): void {
    const ops = diffTx(this.current, nodes);
    if (ops.upserts.length === 0 && ops.deletes.length === 0) return;
    this.current = [...nodes];
    this.ctx.index.withVirtual(this.current);
    this.ctx.log.append(ops, at, VIRTUAL_ORIGIN);
  }
}
