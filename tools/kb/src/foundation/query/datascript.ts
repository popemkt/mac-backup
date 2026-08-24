import * as d from "datascript";
import type { KbNode, NodeId, PropValue } from "../model.ts";

/**
 * Mention form in text: [[node-id|label]] or [[node-id]].
 *
 * The id group excludes `[` as well as `]`/`|`: a real id is ULID/`sys.*`
 * shaped and never contains one, and excluding it lets the regex re-sync to
 * a genuine `[[id]]` marker after a stray extra `[` in surrounding prose
 * (e.g. `[[[id]]`) instead of swallowing that `[` into the captured id.
 */
const MENTION_RE = /\[\[([^[\]|]+)(?:\|[^\]]*)?\]\]/g;

export type Datom = [number | string, string, unknown, number?, boolean?];

/**
 * A query that failed inside the datascript engine — parse or evaluation
 * error in the user-supplied EDN. Distinguishes "the datalog is wrong"
 * (invalid_input at the action boundary) from internal glue failures
 * (normalization / revive bugs, which stay plain `Error` → internal).
 */
export class DatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatalogError";
  }
}

export interface IdMap {
  /** NodeId → integer eid */
  toEid: Map<NodeId, number>;
  /** integer eid → NodeId */
  toId: Map<number, NodeId>;
}

export interface QueryDb {
  db: unknown;
  ids: IdMap;
  nodes: Map<NodeId, KbNode>;
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

export function buildIdMap(nodes: KbNode[]): IdMap {
  const sorted = [...nodes].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const toEid = new Map<NodeId, number>();
  const toId = new Map<number, NodeId>();
  let eid = 1;
  for (const n of sorted) {
    toEid.set(n.id, eid);
    toId.set(eid, n.id);
    eid += 1;
  }
  return { toEid, toId };
}

function fieldAttr(fieldId: NodeId): string {
  return `:f/${fieldId}`;
}

function propDatomValue(
  pv: PropValue,
  ids: IdMap,
): { value: unknown; isRef: boolean } {
  if (pv.t === "ref") {
    const eid = ids.toEid.get(pv.v);
    if (eid === undefined) {
      // dangling ref — store as string sentinel, not a ref join
      return { value: pv.v, isRef: false };
    }
    return { value: eid, isRef: true };
  }
  return { value: pv.v, isRef: false };
}

/** Single-pass nodes → datoms (+ schema entries for ref attrs). */
export function nodesToDatoms(nodes: KbNode[]): {
  datoms: Datom[];
  schema: Record<string, Record<string, string>>;
  ids: IdMap;
} {
  const ids = buildIdMap(nodes);
  const datoms: Datom[] = [];
  const refAttrs = new Set<string>([
    ":node/child",
    ":node/mentions",
  ]);

  for (const node of nodes) {
    const eid = ids.toEid.get(node.id)!;
    datoms.push([eid, ":node/id", node.id]);
    datoms.push([eid, ":node/text", node.text]);
    datoms.push([eid, ":node/created-at", node.createdAt]);
    datoms.push([eid, ":node/updated-at", node.updatedAt]);

    // ordered children vector (eids) + per-child ref for joins
    const childEids: number[] = [];
    for (let i = 0; i < node.children.length; i++) {
      const childId = node.children[i]!;
      const childEid = ids.toEid.get(childId);
      if (childEid === undefined) continue;
      childEids.push(childEid);
      datoms.push([eid, ":node/child", childEid]);
      datoms.push([eid, ":node/child-order", i]);
    }
    if (childEids.length > 0) {
      datoms.push([eid, ":node/children", childEids]);
    }

    for (const [fieldId, values] of Object.entries(node.props)) {
      const attr = fieldAttr(fieldId);
      for (const pv of values) {
        const { value, isRef } = propDatomValue(pv, ids);
        if (isRef) refAttrs.add(attr);
        datoms.push([eid, attr, value]);
      }
    }

    MENTION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MENTION_RE.exec(node.text)) !== null) {
      const mentioned = m[1]!.trim();
      const meid = ids.toEid.get(mentioned);
      if (meid !== undefined) {
        datoms.push([eid, ":node/mentions", meid]);
      }
    }
  }

  const schema: Record<string, Record<string, string>> = {
    ":node/id": { ":db/unique": ":db.unique/identity" },
    ":node/child": {
      ":db/valueType": ":db.type/ref",
      ":db/cardinality": ":db.cardinality/many",
    },
    ":node/mentions": {
      ":db/valueType": ":db.type/ref",
      ":db/cardinality": ":db.cardinality/many",
    },
  };
  for (const attr of refAttrs) {
    if (attr === ":node/child" || attr === ":node/mentions") continue;
    schema[attr] = {
      ":db/valueType": ":db.type/ref",
      ":db/cardinality": ":db.cardinality/many",
    };
  }

  return { datoms, schema, ids };
}

export function buildQueryDb(nodes: KbNode[]): QueryDb {
  const { datoms, schema, ids } = nodesToDatoms(nodes);
  const db = d.init_db(datoms, schema);
  return {
    db,
    ids,
    nodes: new Map(nodes.map((n) => [n.id, n])),
  };
}

function reviveValue(v: unknown, ids: IdMap): unknown {
  if (typeof v === "number" && ids.toId.has(v)) return ids.toId.get(v);
  if (Array.isArray(v)) return v.map((x) => reviveValue(x, ids));
  return v;
}

/** Run raw EDN datalog; entity ids in results are revived to NodeIds when known. */
export function query(db: QueryDb, edn: string, ...inputs: unknown[]): unknown {
  const q = normalizeEdnQuery(edn);
  let raw: unknown;
  try {
    raw = d.q(q, db.db, ...inputs) as unknown;
  } catch (err) {
    // Query parse/evaluation failures are the caller's datalog at fault, not
    // an internal defect — surface them as DatalogError so action surfaces can
    // type them invalid_input while genuine glue bugs stay plain Error.
    throw new DatalogError(
      err instanceof Error ? err.message : String(err),
    );
  }
  return reviveValue(raw, db.ids);
}

export function pull(
  db: QueryDb,
  pattern: string,
  id: NodeId | number,
): unknown {
  let eidOrLookup: number | [string, string];
  if (typeof id === "number") {
    eidOrLookup = id;
  } else if (db.ids.toEid.has(id)) {
    eidOrLookup = db.ids.toEid.get(id)!;
  } else {
    eidOrLookup = [":node/id", id];
  }
  const pat = normalizeEdnQuery(pattern);
  const raw = d.pull(db.db, pat, eidOrLookup) as unknown;
  return revivePull(raw, db.ids);
}

function revivePull(raw: unknown, ids: IdMap): unknown {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== "object") return reviveValue(raw, ids);
  if (Array.isArray(raw)) return raw.map((x) => revivePull(x, ids));
  const obj = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === ":db/id" && typeof v === "number") {
      out[k] = v;
      const nid = ids.toId.get(v);
      if (nid !== undefined) out[":node/id"] = nid;
      continue;
    }
    out[k] = revivePull(v, ids);
  }
  return out;
}

/** Extract [[id|label]] mentions from text. */
export function extractMentions(text: string): NodeId[] {
  const out: NodeId[] = [];
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(text)) !== null) {
    out.push(m[1]!.trim());
  }
  return out;
}
