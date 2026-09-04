/**
 * VERBATIM PORT of tools/kb/packages/query/src/datascript.ts
 *   source sha256 8d09e24efd5f3db512a97871d7f2eaa85b24f6555d6841e5625c2c50838cd62e
 *   at repo commit 2163540
 *
 * Copied, not imported, for two reasons: this bench dir must not add a
 * dependency to any package under tools/kb/packages (r4 brief constraint), and
 * `tools/kb` has no node_modules in this worktree so `@kb/model` does not
 * resolve. The only edits are: the `@kb/model` import replaced by local type
 * declarations + a local `present`, and the query/pull/revive helpers dropped
 * (each runner owns its own query surface). Datom construction is byte-for-byte
 * the same, which is what every candidate must agree with.
 */

export type NodeId = string;

export type PropValue =
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "date"; v: string }
  | { t: "url"; v: string }
  | { t: "ref"; v: NodeId };

export interface KbNode {
  id: NodeId;
  text: string;
  createdAt: string;
  updatedAt: string;
  order?: string;
  children: NodeId[];
  props: Record<string, PropValue[]>;
}

function present<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`missing ${what}`);
  return v;
}

export const MENTION_RE = /\[\[([^[\]|]+)(?:\|[^\]]*)?\]\]/g;

export type Datom = [number | string, string, unknown, number?, boolean?];

export interface IdMap {
  toEid: Map<NodeId, number>;
  toId: Map<number, NodeId>;
}

export function buildIdMap(nodes: KbNode[]): IdMap {
  const sorted = [...nodes].toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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

function propDatomValue(pv: PropValue, ids: IdMap): { value: unknown; isRef: boolean } {
  if (pv.t === "ref") {
    const eid = ids.toEid.get(pv.v);
    if (eid === undefined) return { value: pv.v, isRef: false };
    return { value: eid, isRef: true };
  }
  return { value: pv.v, isRef: false };
}

export function nodesToDatoms(nodes: KbNode[]): {
  datoms: Datom[];
  schema: Record<string, Record<string, string>>;
  ids: IdMap;
} {
  const ids = buildIdMap(nodes);
  const datoms: Datom[] = [];
  const refAttrs = new Set<string>([":node/child", ":node/mentions"]);

  for (const node of nodes) {
    const eid = present(ids.toEid.get(node.id), `eid for ${node.id}`);
    datoms.push([eid, ":node/id", node.id]);
    datoms.push([eid, ":node/text", node.text]);
    datoms.push([eid, ":node/created-at", node.createdAt]);
    datoms.push([eid, ":node/updated-at", node.updatedAt]);

    const childEids: number[] = [];
    for (let i = 0; i < node.children.length; i++) {
      const childId = present(node.children[i], `child ${i} of ${node.id}`);
      const childEid = ids.toEid.get(childId);
      if (childEid === undefined) continue;
      childEids.push(childEid);
      datoms.push([eid, ":node/child", childEid]);
      datoms.push([eid, ":node/child-order", i]);
    }
    if (childEids.length > 0) {
      datoms.push([eid, ":node/children", childEids]);
    }

    const mentioned = new Set<number>();

    for (const [fieldId, values] of Object.entries(node.props)) {
      const attr = fieldAttr(fieldId);
      for (const pv of values) {
        const { value, isRef } = propDatomValue(pv, ids);
        if (isRef) {
          refAttrs.add(attr);
          mentioned.add(value as number);
        }
        datoms.push([eid, attr, value]);
      }
    }

    MENTION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MENTION_RE.exec(node.text)) !== null) {
      const meid = ids.toEid.get(present(m[1], "mention id").trim());
      if (meid !== undefined) mentioned.add(meid);
    }

    for (const meid of mentioned) {
      datoms.push([eid, ":node/mentions", meid]);
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

const QUERY_DIRECTIVES = new Set([
  "find", "where", "in", "with", "keys", "limit", "offset", "rules",
]);

/** Verbatim `normalizeEdnQuery` from the same source file. */
export function normalizeEdnQuery(edn: string): string {
  const keyword = /^:([A-Za-z*][\w./+*-]*)/;
  let out = "";
  let i = 0;
  while (i < edn.length) {
    if (edn[i] === '"') {
      let j = i + 1;
      while (j < edn.length) {
        if (edn[j] === "\\") j += 2;
        else if (edn[j] === '"') { j += 1; break; }
        else j += 1;
      }
      out += edn.slice(i, j);
      i = j;
      continue;
    }
    const m = keyword.exec(edn.slice(i));
    if (m) {
      const directive = present(m[1], "edn keyword");
      out += QUERY_DIRECTIVES.has(directive) ? m[0] : `"${m[0]}"`;
      i += m[0].length;
      continue;
    }
    out += edn[i];
    i += 1;
  }
  return out;
}
