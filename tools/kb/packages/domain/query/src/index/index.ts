import { Context } from "effect";
import type { KbNode, NodeId, StoreTx } from "@kb/model";
import type { Ir } from "../ir/ir.ts";

/**
 * The one owner of "the current graph as something you can ask questions of".
 *
 * A kb session has exactly two collaborators: {@link KbStore}, which owns the
 * committed truth (`.kb/nodes.jsonl`), and this, which owns everything derived
 * from it — the datoms, the id map, the node lookup, the text scan. Nothing
 * outside an implementation of this port may hold a query engine handle, and
 * nothing beside it may hold a second copy of the node set: a service standing
 * next to a `qdb` field is the parallel path Rule 1 forbids.
 *
 * The index is derived and rebuildable. `rebuild` is always correct, so any
 * incremental path an implementation takes is an optimisation it may abandon
 * (see {@link KbIndex.applyTx}), never a source of truth.
 *
 * Reads are synchronous. Every caller today is inside an `Effect.try` that
 * assumes a synchronous throw; an implementation whose point reads are async
 * (a SQLite index) would change three surfaces. Recorded as a `#gap`, not
 * papered over here.
 */
export interface KbIndex {
  /** Bumps on every `rebuild` / `applyTx` / `withVirtual`. */
  readonly generation: number;

  /** Replace the stored node set. The virtual set (see `withVirtual`) survives. */
  rebuild(nodes: ReadonlyArray<KbNode>): void;

  /**
   * Apply one committed transaction. Implementations should do this
   * incrementally and may fall back to a full `rebuild` whenever the tx is
   * outside what their incremental path covers.
   */
  applyTx(tx: StoreTx): void;

  /**
   * Raw datalog in the engine's own dialect, as rows. Engine-specific by
   * construction: this is the surface `graph.query` / `kb query` / the WS
   * `subscribe` frame expose to users, EDN and all.
   */
  runDatalog(edn: string, ...inputs: ReadonlyArray<unknown>): Array<Array<unknown>>;

  /**
   * Engine-neutral query IR. Unlike the raw EDN surface, result positions are
   * typed, so aggregate numbers are never mistaken for engine entity ids.
   */
  run(ir: Ir, ...inputs: ReadonlyArray<unknown>): Array<Array<unknown>>;

  /** Engine pull for one node. Engine-specific for the same reason. */
  pull(pattern: string, id: NodeId): unknown;

  getNode(id: NodeId): KbNode | undefined;

  /** Every node the index answers over — stored plus virtual. */
  allNodes(): Iterable<KbNode>;

  /**
   * The stored projection: everything except the virtual set. This is what
   * persist, transaction integrity and the hub's broadcast diff baseline operate on, and the
   * reason the rule "a virtual node must never reach the store" is enforced
   * by the index rather than remembered at three call sites.
   */
  storedNodes(): Array<KbNode>;

  /** Case-insensitive substring scan over node text, sorted by id. */
  search(text: string, limit?: number): Array<KbNode>;

  /**
   * Index-only nodes: they answer queries and never reach the store. Saved
   * queries are materialised this way by `kb ui`. Replaces the set wholesale;
   * a stored node of the same id always wins.
   */
  withVirtual(nodes: ReadonlyArray<KbNode>): void;
}

export class KbIndexService extends Context.Service<KbIndexService, KbIndex>()("kb/KbIndex") {}
