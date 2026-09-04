// oxlint-disable-next-line typescript/triple-slash-reference -- datascript ships no types; the shim travels with the modules that import it (see ../datascript.d.ts)
/// <reference path="../datascript.d.ts" />
import * as d from "datascript";
import { present, type KbNode, type NodeId, type StoreTx } from "@kb/model";
import { pull as dsPull, query as dsQuery } from "../datascript.ts";
import { type Datom, type DatascriptDb, type IdMap, nodeToDatoms, schemaFor } from "./datoms.ts";
import type { KbIndex } from "./index.ts";

/** Identity of a datom within one entity — attr plus value, compared structurally. */
function datomKey(attr: string, value: unknown): string {
  return `${attr} ${JSON.stringify(value)}`;
}

function normalizeRows(raw: unknown): Array<Array<unknown>> {
  if (raw === undefined || raw === null) return [];
  const list = raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : [];
  return list.map((row) => (Array.isArray(row) ? row : [row]));
}

function byId(a: KbNode, b: KbNode): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The one {@link KbIndex} implementation: an in-memory DataScript db kept
 * incrementally in step with the store.
 *
 * Eids are stable and monotonic — allocated on a node's first appearance and
 * never reused, so a revived eid always means the node it meant before. The
 * schema is derived from the data (a `:f/<field>` attr is a ref attr because
 * some node put a ref in it), which is the one thing `d.db_with` cannot grow:
 * a transaction that introduces a new attr, or turns a known attr into a ref
 * attr, falls back to a full rebuild and is counted in {@link rebuilds}.
 */
export class DatascriptIndex implements KbIndex {
  #db: unknown;
  #generation = 0;
  #rebuilds = 0;
  /** stored + virtual, in the order `storedNodes` must reproduce */
  #nodes = new Map<NodeId, KbNode>();
  #virtual: KbNode[] = [];
  #virtualIds = new Set<NodeId>();
  #ids: IdMap = { toEid: new Map(), toId: new Map() };
  #nextEid = 1;
  #attrs = new Set<string>();
  /** node → the ids it points at */
  #refsFrom = new Map<NodeId, Set<NodeId>>();
  /** id → the nodes pointing at it, resolvable or not */
  #refsTo = new Map<NodeId, Set<NodeId>>();
  #storedCache: { generation: number; nodes: KbNode[] } | null = null;

  constructor(nodes: ReadonlyArray<KbNode> = []) {
    this.rebuild(nodes);
  }

  get generation(): number {
    return this.#generation;
  }

  /** Full index builds since construction — the number Phase 4 gates on. */
  get rebuilds(): number {
    return this.#rebuilds;
  }

  /**
   * The engine handle: this db plus the eid map that reads its integers back
   * as node ids. Exposed because the datascript half still takes it as an
   * argument — `runIr(exec, ir, ids)` and the tests that exercise the engine
   * directly. It closes when `run(ir)` moves onto the port and the index is
   * the only thing that ever holds a db.
   */
  get handle(): DatascriptDb {
    return { db: this.#db, ids: this.#ids };
  }

  rebuild(nodes: ReadonlyArray<KbNode>): void {
    const stored = new Set(nodes.map((n) => n.id));
    this.#virtual = this.#virtual.filter((n) => !stored.has(n.id));
    this.#virtualIds = new Set(this.#virtual.map((n) => n.id));
    const merged = [...nodes, ...this.#virtual];

    this.#nodes = new Map(merged.map((n) => [n.id, n]));
    this.#syncIds(merged);
    this.#refsFrom = new Map();
    this.#refsTo = new Map();
    this.#attrs = new Set();

    const datoms: Datom[] = [];
    for (const node of merged) {
      const built = nodeToDatoms(node, this.#ids);
      datoms.push(...built.datoms);
      for (const attr of built.attrs) this.#attrs.add(attr);
      this.#setRefs(node.id, built.refs);
    }

    this.#db = d.init_db(datoms, schemaFor(this.#attrs));
    this.#rebuilds += 1;
    this.#generation += 1;
  }

  applyTx(tx: StoreTx): void {
    const created = tx.upserts.filter((n) => !this.#nodes.has(n.id)).map((n) => n.id);
    const removed = tx.deletes.filter((id) => this.#nodes.has(id));
    if (created.length === 0 && removed.length === 0 && tx.upserts.length === 0) return;

    // Retractions name the eids as they stand, so they are collected before the
    // id map moves under them.
    const retracts: unknown[] = removed.map((id) => [
      ":db/retractEntity",
      present(this.#ids.toEid.get(id), `eid for ${id}`),
    ]);

    for (const id of created) this.#allocate(id);
    for (const id of removed) this.#forget(id);
    for (const node of tx.upserts) this.#nodes.set(node.id, node);
    for (const id of removed) this.#nodes.delete(id);
    this.#dropVirtual(tx.upserts.map((n) => n.id));

    // A node's datoms depend on whether its targets exist, so every referrer of
    // an id that just appeared or vanished is re-derived alongside the tx.
    const restated = new Map<NodeId, KbNode>();
    for (const node of tx.upserts) restated.set(node.id, node);
    for (const id of [...created, ...removed]) {
      for (const referrer of this.#refsTo.get(id) ?? []) {
        const node = this.#nodes.get(referrer);
        if (node !== undefined) restated.set(referrer, node);
      }
    }

    const adds: unknown[] = [];
    const grown = new Set<string>();
    for (const node of restated.values()) {
      const built = nodeToDatoms(node, this.#ids);
      for (const attr of built.attrs) {
        if (!this.#attrs.has(attr)) grown.add(attr);
      }
      this.#setRefs(node.id, built.refs);
      const eid = present(this.#ids.toEid.get(node.id), `eid for ${node.id}`);
      this.#diffEntity(eid, built.datoms, retracts, adds);
    }

    if (grown.size > 0) {
      // The schema is fixed at `init_db`: a first-seen attr needs its
      // cardinality declared, and only a rebuild can declare it.
      this.rebuild(this.#currentStored());
      return;
    }

    this.#db = d.db_with(this.#db, [...retracts, ...adds]);
    this.#generation += 1;
  }

  runDatalog(edn: string, ...inputs: ReadonlyArray<unknown>): Array<Array<unknown>> {
    return normalizeRows(dsQuery(this.handle, edn, ...inputs));
  }

  pull(pattern: string, id: NodeId): unknown {
    return dsPull(this.handle, pattern, id);
  }

  getNode(id: NodeId): KbNode | undefined {
    return this.#nodes.get(id);
  }

  allNodes(): Iterable<KbNode> {
    return this.#nodes.values();
  }

  storedNodes(): Array<KbNode> {
    if (this.#storedCache?.generation === this.#generation) return this.#storedCache.nodes;
    const nodes = this.#currentStored();
    this.#storedCache = { generation: this.#generation, nodes };
    return nodes;
  }

  search(text: string, limit?: number): Array<KbNode> {
    const needle = text.toLowerCase();
    const hits: KbNode[] = [];
    for (const node of this.#nodes.values()) {
      if (node.text.toLowerCase().includes(needle)) hits.push(node);
    }
    hits.sort(byId);
    return limit !== undefined && hits.length > limit ? hits.slice(0, limit) : hits;
  }

  withVirtual(nodes: ReadonlyArray<KbNode>): void {
    const stored = this.#currentStored();
    const storedIds = new Set(stored.map((n) => n.id));
    this.#virtual = nodes.filter((n) => !storedIds.has(n.id));
    this.#virtualIds = new Set(this.#virtual.map((n) => n.id));
    this.rebuild(stored);
  }

  #currentStored(): KbNode[] {
    const nodes: KbNode[] = [];
    for (const node of this.#nodes.values()) {
      if (!this.#virtualIds.has(node.id)) nodes.push(node);
    }
    return nodes;
  }

  /** Retract what this entity has and add what it should have — the difference only. */
  #diffEntity(eid: number, next: Datom[], retracts: unknown[], adds: unknown[]): void {
    const before = new Map<string, { a: string; v: unknown }>();
    for (const datom of d.datoms(this.#db, ":eavt", eid)) {
      before.set(datomKey(datom.a, datom.v), datom);
    }
    const after = new Set<string>();
    for (const [, attr, value] of next) {
      const key = datomKey(attr, value);
      after.add(key);
      if (!before.has(key)) adds.push([":db/add", eid, attr, value]);
    }
    for (const [key, datom] of before) {
      if (!after.has(key)) retracts.push([":db/retract", eid, datom.a, datom.v]);
    }
  }

  #setRefs(id: NodeId, refs: Set<NodeId>): void {
    for (const target of this.#refsFrom.get(id) ?? []) {
      this.#refsTo.get(target)?.delete(id);
    }
    if (refs.size === 0) this.#refsFrom.delete(id);
    else this.#refsFrom.set(id, refs);
    for (const target of refs) {
      const referrers = this.#refsTo.get(target);
      if (referrers === undefined) this.#refsTo.set(target, new Set([id]));
      else referrers.add(id);
    }
  }

  #dropVirtual(ids: ReadonlyArray<NodeId>): void {
    if (!ids.some((id) => this.#virtualIds.has(id))) return;
    const stored = new Set(ids);
    this.#virtual = this.#virtual.filter((n) => !stored.has(n.id));
    this.#virtualIds = new Set(this.#virtual.map((n) => n.id));
  }

  #allocate(id: NodeId): void {
    if (this.#ids.toEid.has(id)) return;
    this.#ids.toEid.set(id, this.#nextEid);
    this.#ids.toId.set(this.#nextEid, id);
    this.#nextEid += 1;
  }

  /** Drop the mapping; the number itself is retired, never handed out again. */
  #forget(id: NodeId): void {
    const eid = this.#ids.toEid.get(id);
    if (eid === undefined) return;
    this.#ids.toEid.delete(id);
    this.#ids.toId.delete(eid);
    this.#setRefs(id, new Set());
  }

  #syncIds(nodes: ReadonlyArray<KbNode>): void {
    const live = new Set(nodes.map((n) => n.id));
    // Deleting the entry the Map iterator is on is well defined, so the live
    // ids are filtered in one pass rather than over a copy.
    for (const [id, eid] of this.#ids.toEid) {
      if (live.has(id)) continue;
      this.#ids.toEid.delete(id);
      this.#ids.toId.delete(eid);
    }
    for (const node of nodes) this.#allocate(node.id);
  }
}
