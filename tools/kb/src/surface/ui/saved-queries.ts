import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SYSTEM_IDS, type KbNode } from "../../foundation/model.ts";
import { pathExists } from "./paths.ts";

export async function listSavedQueries(
  root: string,
): Promise<{ name: string; edn: string }[]> {
  const dir = join(root, ".kb", "queries");
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir);
  const out: { name: string; edn: string }[] = [];
  for (const name of entries) {
    if (!name.endsWith(".edn")) continue;
    const edn = await readFile(join(dir, name), "utf8");
    out.push({ name: name.slice(0, -4), edn });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
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
