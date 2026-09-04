/**
 * Client-side datalog execution. The EDN dialect (`normalizeEdnQuery`) lives in
 * `@kb/query`; this module owns the browser runner and eid revival.
 */
import * as d from "datascript";
import { normalizeEdnQuery } from "@kb/query";
import type { QueryDb } from "./db";
import type { IdMap } from "./datoms";

function reviveValue(v: unknown, ids: IdMap): unknown {
  if (typeof v === "number" && ids.toId.has(v)) return ids.toId.get(v);
  if (Array.isArray(v)) return v.map((x) => reviveValue(x, ids));
  return v;
}

/** Run raw EDN datalog; entity ids in results are revived to node ids. */
export function runQuery(qdb: QueryDb, edn: string): unknown[][] {
  const q = normalizeEdnQuery(edn);
  const raw = d.q(q, qdb.db);
  const revived = reviveValue(raw, qdb.ids);
  if (revived === null || revived === undefined) return [];
  const list = revived instanceof Set ? [...revived] : Array.isArray(revived) ? revived : [];
  return list.map((r) => (Array.isArray(r) ? r : [r]));
}
