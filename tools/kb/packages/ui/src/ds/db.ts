import * as d from "datascript";
import type { WireNode } from "@kb/contracts";
import { backlinksQuery } from "@kb/query";
import { runQuery } from "./query";
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

/**
 * Nodes that reference `targetId`. The EDN comes from the backend through
 * `@kb/queries` — one owner for "what references X", so the CLI's
 * `kb backlinks` and the UI's References section cannot answer it differently.
 */
export function queryBacklinks(db: QueryDb, targetId: string): Array<{ id: string; text: string }> {
  return runQuery(db, backlinksQuery(targetId)).flatMap((row: unknown[]) =>
    Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string"
      ? [{ id: row[0], text: row[1] }]
      : [],
  );
}
