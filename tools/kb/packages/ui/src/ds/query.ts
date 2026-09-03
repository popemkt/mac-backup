/**
 * Client-side datalog execution — pure parts copied from
 * tools/kb/src/foundation/query/datascript.ts (isomorphic; no Node APIs).
 * Same EDN dialect as `kb query` / graph.query / WS subscriptions.
 */
import * as d from "datascript";
import type { QueryDb } from "./db";
import type { IdMap } from "./datoms";

const QUERY_DIRECTIVES = new Set([
  "find",
  "where",
  "in",
  "with",
  "keys",
  "limit",
  "offset",
  "rules",
]);

/**
 * DataScript JS API stores attrs as strings; EDN queries use keywords.
 * Rewrite `:attr` → `":attr"` (quoted) except query directives.
 */
export function normalizeEdnQuery(edn: string): string {
  const keyword = /^:([A-Za-z*][\w./+*-]*)/;
  let out = "";
  let i = 0;
  while (i < edn.length) {
    if (edn[i] === '"') {
      let j = i + 1;
      while (j < edn.length) {
        if (edn[j] === "\\") j += 2;
        else if (edn[j] === '"') {
          j += 1;
          break;
        } else j += 1;
      }
      out += edn.slice(i, j);
      i = j;
      continue;
    }
    const m = keyword.exec(edn.slice(i));
    if (m) {
      out += QUERY_DIRECTIVES.has(m[1]!) ? m[0] : `"${m[0]}"`;
      i += m[0].length;
      continue;
    }
    out += edn[i];
    i += 1;
  }
  return out;
}

function reviveValue(v: unknown, ids: IdMap): unknown {
  if (typeof v === "number" && ids.toId.has(v)) return ids.toId.get(v);
  if (Array.isArray(v)) return v.map((x) => reviveValue(x, ids));
  return v;
}

/** Run raw EDN datalog; entity ids in results are revived to node ids. */
export function runQuery(qdb: QueryDb, edn: string): unknown[][] {
  const q = normalizeEdnQuery(edn);
  const raw = d.q(q, qdb.db) as unknown;
  const revived = reviveValue(raw, qdb.ids);
  if (revived == null) return [];
  const list = revived instanceof Set ? [...revived] : Array.isArray(revived) ? revived : [];
  return list.map((r) => (Array.isArray(r) ? r : [r]));
}
