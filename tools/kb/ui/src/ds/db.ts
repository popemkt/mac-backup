import * as d from "datascript";
import type { WireNode } from "@kb/protocol";
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
