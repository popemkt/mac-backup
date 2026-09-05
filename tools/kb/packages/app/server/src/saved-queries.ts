import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { SavedQueries, type SavedQuery } from "@kb/contracts";
import { savedQueriesLayer } from "@kb/workspace-fs";
import { bunFileSystemLayer } from "@kb/store-jsonl";
import { SYSTEM_IDS, type KbNode } from "@kb/model";

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
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.queryTag }],
      [SYSTEM_IDS.queryField]: [{ t: "str", v: q.edn.trim() }],
    }),
  );
  const root = mk(SYSTEM_IDS.queriesRoot, "Saved queries", {});
  root.children = queries.map((q) => q.id);
  return [root, ...queries];
}
