import { Effect } from "effect";
import type { EffectStore, StoreCommit, TxRecord } from "@kb/contracts";
import type { DomainError, KbNode, StoreTx } from "@kb/model";
import { MemoryTxTail } from "@kb/tx-log";

/** In-memory persistence side of the browser's replicated kb session. */
export class BrowserStore implements EffectStore {
  readonly path = "browser";
  /** Nothing on a filesystem to watch: the server pushes this store its news. */
  readonly watchPaths: readonly string[] = [];
  readonly loadEffect: Effect.Effect<KbNode[], DomainError>;

  /**
   * In memory, because this store is a replica: the server's tail is the
   * durable one, and a second durable copy in the browser would be a record
   * with no authority claiming to be one.
   */
  readonly txTail = new MemoryTxTail();

  private readonly byId = new Map<string, KbNode>();
  private generation = 0;
  readonly fingerprint = Effect.sync(() => String(this.generation));

  constructor(nodes: readonly KbNode[]) {
    this.replace(nodes);
    this.loadEffect = Effect.sync(() => [...this.byId.values()]);
  }

  commitEffect(tx: StoreTx, record: TxRecord): Effect.Effect<StoreCommit, DomainError> {
    return Effect.sync(() => {
      // Single-threaded and synchronous: nothing can land between the read of
      // the generation and the write that bumps it, or between that and the
      // record — which is what "one critical section" means in a browser.
      const base = String(this.generation);
      this.apply(tx);
      if (tx.upserts.length > 0 || tx.deletes.length > 0) this.txTail.append(tx, record);
      return { base, fingerprint: String(this.generation) };
    });
  }

  /** Keep the store side current when the replica ingests a server tx. */
  apply(tx: StoreTx): void {
    for (const id of tx.deletes) this.byId.delete(id);
    for (const node of tx.upserts) this.byId.set(node.id, node);
    this.generation += 1;
  }

  /** Replace the snapshot after an authoritative server snapshot. */
  replace(nodes: readonly KbNode[]): void {
    this.byId.clear();
    for (const node of nodes) this.byId.set(node.id, node);
    this.generation += 1;
  }
}
