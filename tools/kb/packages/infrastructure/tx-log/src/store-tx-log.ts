import type { KbTxLog, TxTail } from "@kb/contracts";
import type { KbTx, StoreTx } from "@kb/model";

/**
 * The session's view of a store's {@link TxTail}.
 *
 * It holds no history. The tail is the sequence — durable, per store, and
 * shared by every process writing that root — so this class is only the three
 * things a session adds to it: the rev it has caught up to, the subscribers it
 * notifies, and the `floor` below which frames may not be replayed.
 *
 * `floor` is the crash story made explicit. The tail's last entry carries the
 * store's own commit mark, so at open the tail can say whether it describes
 * the store as it is now. When it does not — a process killed between the node
 * write and the append, or a store written by something that never recorded a
 * transaction — every rev at or below head describes a graph that is not the
 * one on disk. Rather than replay those frames, the log refuses them: `floor`
 * becomes `head + 1`, so `since` answers `"snapshot-required"` until a fresh
 * append gives it something it can stand behind.
 */
export class StoreTxLog implements KbTxLog {
  private readonly tail: TxTail;
  private readonly subscribers = new Set<(tx: KbTx) => void>();
  private rev: number;
  /** The lowest rev a caller may be caught up *from*. See the class comment. */
  private readonly floor: number;

  constructor(tail: TxTail) {
    this.tail = tail;
    this.rev = tail.head();
    this.floor = tail.isCurrent() ? 0 : this.rev + 1;
  }

  get head(): number {
    return this.rev;
  }

  refresh(): KbTx[] {
    const caught = this.tail.entries().filter((tx) => tx.rev > this.rev);
    for (const tx of caught) this.record(tx);
    return caught;
  }

  append(ops: StoreTx, at: string, origin?: string): KbTx {
    const tx = this.tail.append(ops, origin === undefined ? { at } : { at, origin });
    this.record(tx);
    return tx;
  }

  since(rev: number): KbTx[] | "snapshot-required" {
    // Ahead of head: the caller counted against another store. Nothing this
    // tail holds describes the graph they have.
    if (rev > this.rev) return "snapshot-required";
    // At or below a stale head: the store moved without the tail, so even a
    // caller that is *at* head is holding a graph no frame can correct.
    if (rev < this.floor) return "snapshot-required";
    if (rev === this.rev) return [];
    const entries = this.tail.entries().filter((tx) => tx.rev > rev);
    // The caller needs rev+1 onwards; if compaction has dropped it, no
    // sequence of frames can reconstruct the graph they are holding.
    const oldest = entries[0];
    if (oldest === undefined || oldest.rev > rev + 1) return "snapshot-required";
    return entries;
  }

  subscribe(fn: (tx: KbTx) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  /** Advance to `tx` and tell everyone. The one place head moves. */
  private record(tx: KbTx): void {
    if (tx.rev <= this.rev) return;
    this.rev = tx.rev;
    for (const fn of this.subscribers) fn(tx);
  }
}
