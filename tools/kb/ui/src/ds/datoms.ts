/**
 * Client-side DataScript datom builder — pure parts copied from
 * tools/kb/src/foundation/query/datascript.ts (isomorphic; no Node APIs).
 */
import type { WireNode } from "@kb/protocol";

export type NodeId = string;
export type PropValue = WireNode["props"][string][number];

/** Mention form in text: [[node-id|label]] or [[node-id]] */
const MENTION_RE = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

export type Datom = [number | string, string, unknown, number?, boolean?];

export interface IdMap {
  toEid: Map<NodeId, number>;
  toId: Map<number, NodeId>;
}

export interface NodesToDatomsResult {
  datoms: Datom[];
  schema: Record<string, Record<string, string>>;
  ids: IdMap;
}

export function buildIdMap(nodes: Array<{ id: NodeId }>): IdMap {
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
      return { value: pv.v, isRef: false };
    }
    return { value: eid, isRef: true };
  }
  return { value: pv.v, isRef: false };
}

/** Single-pass nodes → datoms (+ schema entries for ref attrs). */
export function nodesToDatoms(
  nodes: Array<{
    id: NodeId;
    text: string;
    props: WireNode["props"];
    children: NodeId[];
    createdAt: string;
    updatedAt: string;
  }>,
): NodesToDatomsResult {
  const ids = buildIdMap(nodes);
  const datoms: Datom[] = [];
  const refAttrs = new Set<string>([":node/child", ":node/mentions"]);

  for (const node of nodes) {
    const eid = ids.toEid.get(node.id)!;
    datoms.push([eid, ":node/id", node.id]);
    datoms.push([eid, ":node/text", node.text]);
    datoms.push([eid, ":node/created-at", node.createdAt]);
    datoms.push([eid, ":node/updated-at", node.updatedAt]);

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

export function extractMentions(text: string): NodeId[] {
  const out: NodeId[] = [];
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(text)) !== null) {
    out.push(m[1]!.trim());
  }
  return out;
}
