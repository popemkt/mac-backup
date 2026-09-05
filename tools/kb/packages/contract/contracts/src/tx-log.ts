import { Context } from "effect";
import type { KbTx, StoreTx } from "@kb/model";

/**
 * The one producer of "what changed, in order".
 *
 * Before it, three surfaces each derived a delta of their own: persist held
 * the real transaction and dropped it, the hub re-diffed a private copy of
 * the node set to get it back, and a client that fell behind refetched the
 * whole graph. The log is authored once, at the commit that made it, and
 * every reader — the hub, a catching-up client, a replica index — reads the
 * same sequence.
 *
 * Synchronous, like {@link KbIndex} and for the same reason: every caller is
 * already inside a commit that must not yield between writing and recording.
 * `at` is a parameter rather than a `Clock` read because time has exactly one
 * owner in this codebase and it is an Effect service (`@kb/model`'s
 * `currentIso`); a synchronous port that read the wall clock would be a second
 * one.
 *
 * Reached as {@link KbContext.log}, beside the index, and not also as a
 * Context service: a session already hands its collaborators to everything
 * that holds it, and a second accessor for the same instance is a second place
 * to keep in sync.
 */
export interface KbTxLog {
  /** The rev of the newest appended transaction; 0 when nothing is logged. */
  readonly head: number;

  /** Record one committed transaction and notify subscribers. */
  append(ops: StoreTx, at: string, origin?: string): KbTx;

  /**
   * Everything after `rev`, oldest first. Empty when the caller is current.
   *
   * `"snapshot-required"` when the log cannot express the difference as
   * frames. That is one answer with two causes, deliberately: the window has
   * dropped `rev + 1`, or `rev` is ahead of `head` because it belongs to
   * another process's counter (`rev` is per-server, so a restart resets it).
   * Both mean the same thing to a caller, and naming them apart would put the
   * distinction at every call site instead of here.
   */
  since(rev: number): KbTx[] | "snapshot-required";

  /** Observe every subsequent append. Returns the unsubscribe. */
  subscribe(fn: (tx: KbTx) => void): () => void;
}

/**
 * Who asked for the write, when the surface that took the request knows.
 *
 * Ambient rather than a parameter because that is what it is: no action cares
 * which client invoked it, and threading it through every handler to reach the
 * one line that records it would put a request-shaped argument in the domain.
 * A `Reference` has a default, so nothing downstream gains a requirement — an
 * origin-less surface (the CLI, the watcher) simply gets `undefined`.
 *
 * It is a label on the transaction, not a filter: the server echoes every tx
 * to every watcher including its origin, so a client can recognise the
 * confirmation of its own optimistic apply instead of never hearing about it.
 */
export const TxOrigin = Context.Reference<string | undefined>("kb/TxOrigin", {
  defaultValue: () => undefined,
});
