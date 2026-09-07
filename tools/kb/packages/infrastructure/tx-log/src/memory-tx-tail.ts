import type { TxRecord, TxTail } from "@kb/contracts";
import type { KbTx, StoreTx } from "@kb/model";

/**
 * A {@link TxTail} that lives and dies with the process.
 *
 * Not a store's tail: a store's tail is durable by definition, and the two
 * shipped adapters each have one. This is the tail a *store without a file*
 * has — the browser's replicated store, whose authority is the server it is
 * replicating, and a test fixture that wants the log's semantics without a
 * filesystem. Both are stores whose nodes are already somewhere else; a
 * durable tail beside them would be a third copy of a sequence they do not own.
 *
 * `isCurrent` is therefore always true: nothing here can outlive the store it
 * belongs to, so head cannot be stale with respect to it.
 */
export class MemoryTxTail implements TxTail {
  private entriesInOrder: KbTx[] = [];

  head(): number {
    return this.entriesInOrder.at(-1)?.rev ?? 0;
  }

  isCurrent(): boolean {
    return true;
  }

  entries(): KbTx[] {
    return [...this.entriesInOrder];
  }

  append(ops: StoreTx, record: TxRecord): KbTx {
    const rev = this.head() + 1;
    const tx: KbTx =
      record.origin === undefined
        ? { rev, ops, at: record.at }
        : { rev, ops, at: record.at, origin: record.origin };
    this.entriesInOrder.push(tx);
    return tx;
  }

  adopt(txs: readonly KbTx[]): void {
    this.entriesInOrder = [...txs];
  }
}
