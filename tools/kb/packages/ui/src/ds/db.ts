import * as d from "datascript";
import type { WireNode } from "@kb/contracts";
import { backlinksQuery } from "@kb/query";
import { nodesToDatoms, type IdMap } from "./datoms";

export interface QueryDb {
  db: unknown;
  ids: IdMap;
  nodes: Map<string, WireNode>;
  rev: number;
}

export function buildQueryDb(nodes: WireNode[], rev = 0): QueryDb {
  const { datoms, schema, ids } = nodesToDatoms(nodes);
  const db = d.init_db(datoms, schema);
  return {
    db,
    ids,
    nodes: new Map(nodes.map((n) => [n.id, n])),
    rev,
  };
}

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

/** DataScript JS API stores attrs as strings; EDN queries use keywords. */
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

/** Run raw EDN datalog; entity ids revived to NodeIds when known. */
export function query(db: QueryDb, edn: string, ...inputs: unknown[]): unknown {
  const q = normalizeEdnQuery(edn);
  const raw = d.q(q, db.db, ...inputs);
  return reviveValue(raw, db.ids);
}

/**
 * Nodes that reference `targetId`. The EDN comes from the backend through
 * `@kb/queries` — one owner for "what references X", so the CLI's
 * `kb backlinks` and the UI's References section cannot answer it differently.
 */
export function queryBacklinks(db: QueryDb, targetId: string): Array<{ id: string; text: string }> {
  const rows = query(db, backlinksQuery(targetId)) as Array<[string, string]>;
  if (!Array.isArray(rows)) return [];
  return rows.map(([id, text]) => ({ id, text }));
}
