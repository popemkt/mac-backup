import { join } from "node:path";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { bunFileSystemLayer } from "../../context.ts";
import { SYSTEM_IDS, type KbNode } from "../../foundation/model.ts";
import { isValidSavedQueryName } from "../../foundation/saved-query.ts";

export const listSavedQueriesEffect = Effect.fn("kb.ui.listSavedQueries")(
  function* (root: string) {
    const fs = yield* FileSystem;
    const dir = join(root, ".kb", "queries");
    // Platform I/O errors become defects; HTTP catchCause maps them to 500.
    if (!(yield* fs.exists(dir).pipe(Effect.orDie))) return [];
    const entries = yield* fs.readDirectory(dir).pipe(Effect.orDie);
    const out: { name: string; edn: string }[] = [];
    for (const name of entries) {
      if (!name.endsWith(".edn")) continue;
      const stem = name.slice(0, -4);
      // Skip traversal/control/ambiguous stems — same rule as run/save/delete.
      if (!isValidSavedQueryName(stem)) continue;
      const edn = yield* fs
        .readFileString(join(dir, name))
        .pipe(Effect.orDie);
      out.push({ name: stem, edn });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },
);

export function listSavedQueries(
  root: string,
): Promise<{ name: string; edn: string }[]> {
  return Effect.runPromise(
    listSavedQueriesEffect(root).pipe(Effect.provide(bunFileSystemLayer)),
  );
}

/** Stable timestamp keeps virtual nodes out of the content-hash noise. */
const SAVED_QUERY_ISO = "1970-01-01T00:00:00.000Z";

/**
 * Saved queries (.kb/queries/*.edn) surfaced as query nodes under a
 * `sys.queries` root (DESIGN-REFINE §2 W4). Materialized at load into the
 * UI graph only — never duplicated into .kb/nodes.jsonl.
 */
export function savedQueryNodes(
  saved: { name: string; edn: string }[],
): KbNode[] {
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
