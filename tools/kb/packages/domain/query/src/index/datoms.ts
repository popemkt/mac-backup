// oxlint-disable-next-line typescript/triple-slash-reference -- datascript ships no types; the shim travels with the query package (see ../datascript.d.ts)
/// <reference path="../datascript.d.ts" />
import * as d from "datascript";
import { present, type KbNode, type NodeId, type PropValue } from "@kb/model";

/**
 * `:node/mentions` is THE reference relation — "this node references that one"
 * — and it is carrier-independent by design.
 *
 * Two things carry a reference in this model: a `[[node-id]]` token in text and
 * a `{t:"ref"}` prop value. Both are already first-class, so a question about
 * the relation ("what references X?" — `kb backlinks`, the UI's References
 * section) must not have to remember which carrier was used; asking twice and
 * unioning at every call site is the second `if` on one distinction that Rule 1
 * forbids. The carrier distinction survives only where it is genuinely a lens:
 * the graph's `mention` / `ref-prop` edge kinds, which label provenance and
 * scan text and props separately for exactly that reason.
 */

/**
 * Mention form in text: [[node-id|label]] or [[node-id]].
 *
 * The id group excludes `[` as well as `]`/`|`: a real id is ULID/`sys.*`
 * shaped and never contains one, and excluding it lets the regex re-sync to
 * a genuine `[[id]]` marker after a stray extra `[` in surrounding prose
 * (e.g. `[[[id]]`) instead of swallowing that `[` into the captured id.
 */
const MENTION_RE = /\[\[([^[\]|]+)(?:\|[^\]]*)?\]\]/g;

type Datom = [number | string, string, unknown, number?, boolean?];

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

function buildIdMap(nodes: KbNode[]): IdMap {
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

/** Discriminated so a ref's value is known to be the entity id it is. */
type DatomValue = { isRef: true; value: number } | { isRef: false; value: unknown };

function propDatomValue(pv: PropValue, ids: IdMap): DatomValue {
  if (pv.t === "ref") {
    const eid = ids.toEid.get(pv.v);
    if (eid === undefined) {
      // dangling ref — store as string sentinel, not a ref join
      return { isRef: false, value: pv.v };
    }
    return { isRef: true, value: eid };
  }
  return { isRef: false, value: pv.v };
}

/** Single-pass nodes → datoms (+ schema entries for ref attrs). */
function nodesToDatoms(nodes: KbNode[]): {
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

    // ordered children vector (eids) + per-child ref for joins
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

    // One mention datom per (source, target), whichever carrier produced it —
    // `:node/mentions` is cardinality-many, so a duplicate would be a duplicate
    // datom rather than a no-op.
    const mentioned = new Set<number>();

    for (const [fieldId, values] of Object.entries(node.props)) {
      const attr = fieldAttr(fieldId);
      for (const pv of values) {
        const datomValue = propDatomValue(pv, ids);
        if (datomValue.isRef) {
          refAttrs.add(attr);
          mentioned.add(datomValue.value);
        }
        datoms.push([eid, attr, datomValue.value]);
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

export function buildQueryDb(nodes: KbNode[]): QueryDb {
  const { datoms, schema, ids } = nodesToDatoms(nodes);
  const db = d.init_db(datoms, schema);
  return {
    db,
    ids,
    nodes: new Map(nodes.map((n) => [n.id, n])),
  };
}

/** Extract [[id|label]] mentions from text. */
export function extractMentions(text: string): NodeId[] {
  const out: NodeId[] = [];
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(text)) !== null) {
    out.push(present(m[1], "mention id").trim());
  }
  return out;
}
