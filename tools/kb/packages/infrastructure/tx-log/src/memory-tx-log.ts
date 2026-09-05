import type { KbTxLog } from "@kb/contracts";
import type { KbTx, StoreTx } from "@kb/model";

/**
 * How many transactions the window holds. A client that has been away longer
 * than this takes a snapshot instead — the cost of the ring is bounded, and
 * the snapshot path has to exist anyway (a client can arrive at rev 0 against
 * a server that has been running for a week).
 */
export const TX_LOG_DEFAULT_CAPACITY = 1000;

/**
 * The process-local {@link KbTxLog}: a bounded window over the tail of the
 * sequence.
 *
 * `rev` keeps its documented meaning — a per-server counter, not a durable
 * identity — so the log is authoritative for one process's lifetime and a
 * restart puts every client through the snapshot path it already has. The
 * durable form (`.kb/tx.jsonl` written under the store's write lock) is a
 * later wave; nothing here assumes memory, only `since` can answer `"too-old"`.
 */
export class MemoryTxLog implements KbTxLog {
  /** Oldest first; length is bounded by {@link capacity}. */
  private readonly window: KbTx[] = [];
  private readonly subscribers = new Set<(tx: KbTx) => void>();
  private rev = 0;
  private readonly capacity: number;

  constructor(capacity: number = TX_LOG_DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  get head(): number {
    return this.rev;
  }

  append(ops: StoreTx, at: string, origin?: string): KbTx {
    this.rev += 1;
    const tx: KbTx =
      origin === undefined ? { rev: this.rev, ops, at } : { rev: this.rev, ops, at, origin };
    this.window.push(tx);
    if (this.window.length > this.capacity) {
      this.window.splice(0, this.window.length - this.capacity);
    }
    for (const fn of this.subscribers) fn(tx);
    return tx;
  }

  since(rev: number): KbTx[] | "too-old" {
    if (rev >= this.rev) return [];
    const oldest = this.window[0];
    // The caller needs rev+1 onwards; if the window has already dropped it,
    // no sequence of frames can reconstruct the graph they are holding.
    if (oldest === undefined || oldest.rev > rev + 1) return "too-old";
    return this.window.filter((tx) => tx.rev > rev);
  }

  subscribe(fn: (tx: KbTx) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }
}
