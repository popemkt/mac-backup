import { present, type KbNode, type NodeId, type PropValue } from "@kb/model";
import type { DerivedRef } from "./derived.ts";

export type Datom = [number | string, string, unknown, number?, boolean?];

export interface IdMap {
  /** NodeId → integer eid */
  toEid: Map<NodeId, number>;
  /** integer eid → NodeId */
  toId: Map<number, NodeId>;
}

/**
 * A datascript db plus the eid map needed to read it back as node ids. The
 * engine handle, and nothing else: the node set, the virtual set and the
 * generation belong to the index that owns this handle.
 */
export interface DatascriptDb {
  db: unknown;
  ids: IdMap;
  /**
   * The field attrs that hold a node ref somewhere in the data: a bare number
   * read from one of them is an entity, from any other a number.
   */
  refAttrs: ReadonlySet<string>;
}

function fieldAttr(fieldId: NodeId): string {
  return `:f/${fieldId}`;
}

/** Discriminated so a ref's value is known to be the entity id it is. */
type DatomValue = { isRef: true; value: number } | { isRef: false; value: unknown };

// GAP [[01M3A0Y5JQ5XKZMC87K34HDT2B]] — a ref and a {t:num} share the bare-number encoding.
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

/** One node's datoms, the schema it needs, and everything it points at. */
export interface NodeDatoms {
  datoms: Datom[];
  /** the attrs this node carries, so the schema can grow with the data */
  attrs: Set<string>;
  /** the field attrs among them that hold a resolving node ref */
  refAttrs: Set<string>;
  /**
   * Every node id this node points at — a child, a prop's key (its field
   * node), a `{t:"ref"}` prop, or any carrier of a derived attribute
   * (`DerivedRef`) — whether or not the target resolves today. An
   * unresolved target degrades to a string sentinel (props) or is dropped
   * (children, derived refs), so the datoms of this node change the moment
   * that target starts or stops existing. The index keeps the reverse of
   * this set and re-derives the referrers on those transitions; a key's
   * field is among them though its datoms do not change, which costs only
   * the re-derivation.
   */
  refs: Set<NodeId>;
}

/** What each derived attribute's carriers read off `node`: the ids it points at by them, in order. */
function carriedBy(
  node: KbNode,
  derived: readonly DerivedRef[],
): { readonly attr: string; readonly ids: readonly NodeId[] }[] {
  return derived.map(({ attr, carriers }) => ({
    attr,
    ids: carriers.flatMap((carrier) => [...carrier.refsOf(node)]),
  }));
}

/**
 * Every id `node` points at (`NodeDatoms.refs`), given what its carriers
 * read: its children, each prop's key (the field node the values are of)
 * and each ref value.
 */
function pointedAt(node: KbNode, carried: ReturnType<typeof carriedBy>): Set<NodeId> {
  const refs = new Set<NodeId>(node.children);
  for (const [field, values] of Object.entries(node.props)) {
    refs.add(field);
    for (const pv of values) if (pv.t === "ref") refs.add(pv.v);
  }
  for (const { ids } of carried) for (const id of ids) refs.add(id);
  return refs;
}

/**
 * Every id `node` points at — a child, a ref value, or any carrier of a
 * derived attribute — resolvable or not: the `refs` of its datoms, read
 * without building them, so a node only planned can be asked too.
 */
export function nodeRefs(node: KbNode, derived: readonly DerivedRef[]): Set<NodeId> {
  return pointedAt(node, carriedBy(node, derived));
}

/**
 * One node → its datoms: what it states, then each derived ref attribute in
 * `derived` from its carriers. Pure in (node, ids, derived): the index owns
 * all three.
 */
export function nodeToDatoms(node: KbNode, ids: IdMap, derived: readonly DerivedRef[]): NodeDatoms {
  const eid = present(ids.toEid.get(node.id), `eid for ${node.id}`);
  const datoms: Datom[] = [];
  const attrs = new Set<string>();
  const refAttrs = new Set<string>();
  const carried = carriedBy(node, derived);
  const refs = pointedAt(node, carried);

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

  for (const [fieldId, values] of Object.entries(node.props)) {
    const attr = fieldAttr(fieldId);
    for (const pv of values) {
      const datomValue = propDatomValue(pv, ids);
      attrs.add(attr);
      if (datomValue.isRef) refAttrs.add(attr);
      datoms.push([eid, attr, datomValue.value]);
    }
  }

  // One datom per (source, target) and attribute, whichever carrier produced
  // it: a derived attr is a set, so a duplicate would be a duplicate datom
  // rather than a no-op.
  for (const { attr, ids: carriedIds } of carried) {
    const targets = new Set<number>();
    for (const id of carriedIds) {
      const target = ids.toEid.get(id);
      if (target !== undefined) targets.add(target);
    }
    for (const target of targets) datoms.push([eid, attr, target]);
  }

  return { datoms, attrs, refAttrs, refs };
}

/**
 * Datascript schema for the field attrs the data has produced.
 *
 * Two things are declared, and only these two:
 *
 * - **Cardinality.** Every attr a node can carry more than once is
 *   `:db.cardinality/many`. Under `init_db` that is decoration — raw datoms
 *   bypass cardinality — but the incremental path transacts, and a
 *   cardinality-one `:db/add` *replaces* the previous value instead of
 *   accumulating. Props are multi-valued and a parent has one
 *   `:node/child-order` datom per child, so the two paths only agree when the
 *   schema says so. One derivation, both paths.
 * - **Ref value type**, for `:node/child` and each derived ref attribute
 *   (`derived`, with the cardinality it declares) only. A prop
 *   ref is a plain eid: joins read it as an entity either way, but a field
 *   attr is the one place a *dangling* ref survives as its id string
 *   (DANGLING_REF_DECISION), and a string on a ref-typed attr is a tempid to
 *   `db_with`. Declaring those attrs ref would make the incremental path
 *   reject exactly the data the rebuild path keeps.
 */
export function schemaFor(
  attrs: ReadonlySet<string>,
  derived: readonly DerivedRef[],
): Record<string, Record<string, string>> {
  const many = { ":db/cardinality": ":db.cardinality/many" };
  const ref = { ":db/valueType": ":db.type/ref" };
  const schema: Record<string, Record<string, string>> = {
    ":node/id": { ":db/unique": ":db.unique/identity" },
    ":node/child": { ...ref, ...many },
    ":node/child-order": { ...many },
  };
  for (const { attr, cardinality } of derived) {
    schema[attr] = cardinality === "many" ? { ...ref, ...many } : { ...ref };
  }
  for (const attr of attrs) {
    if (attr in schema) continue;
    schema[attr] = { ...many };
  }
  return schema;
}
