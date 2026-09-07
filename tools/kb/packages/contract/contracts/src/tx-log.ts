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
 * The sequence itself is not here: it lives in the store, as
 * {@link EffectStore.txTail}. This interface is the *view* of that tail a
 * session holds — the head it has caught up to, the subscribers it notifies,
 * and the two ways a transaction gets into the sequence. There is no window,
 * no ring and no second copy: a log that kept its own bounded history beside
 * a durable tail would be two records of one sequence, and the shorter one
 * would be the one that answered `snapshot-required` first.
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
  /**
   * The rev of the newest transaction this session has caught up to; 0 when
   * the tail is empty. Per *store* and durable: it survives a restart, so a
   * client that reconnects with the rev it had is caught up with frames
   * instead of a full snapshot.
   */
  readonly head: number;

  /**
   * Adopt whatever the tail holds past {@link head} — records and notifies
   * each, oldest first, and returns them.
   *
   * This is how a transaction another process committed reaches this session:
   * the tail is the store's, so a CLI write is already in it by the time the
   * watcher fires, and reading it is cheaper and more truthful than
   * reconstructing the delta by diffing node sets. Also how a session's own
   * commit is recorded, since the store appends inside the commit.
   */
  refresh(): KbTx[];

  /**
   * Persist and record one transaction the store did not commit, and notify
   * subscribers.
   *
   * The saved-query virtual set is the live case: those nodes answer queries
   * and never reach the store, so nothing else would ever put them in the
   * sequence — and a client catching up with `since` would end with a graph a
   * fresh snapshot disagrees with. The other case is an unlogged store write
   * (a hand-edited `nodes.jsonl`), whose delta the watcher recovers by diff
   * because no transaction was ever recorded for it.
   */
  append(ops: StoreTx, at: string, origin?: string): KbTx;

  /**
   * Everything after `rev`, oldest first. Empty when the caller is current.
   *
   * `"snapshot-required"` when the log cannot express the difference as
   * frames. That is one answer with three causes, deliberately: the tail has
   * been compacted past `rev + 1`, `rev` is ahead of {@link head} because it
   * belongs to another store's counter, or the tail is behind the store it
   * describes (see {@link TxTail.isCurrent}) so no rev at or below head can be
   * trusted. All three mean the same thing to a caller, and naming them apart
   * would put the distinction at every call site instead of here.
   */
  since(rev: number): KbTx[] | "snapshot-required";

  /** Observe every subsequent append. Returns the unsubscribe. */
  subscribe(fn: (tx: KbTx) => void): () => void;
}

/**
 * The caller's half of a log record: when the transaction was made, and who
 * asked for it. The rev is not here because the tail assigns it — that is the
 * whole point of the tail owning the sequence.
 */
export interface TxRecord {
  /** The `Clock` reading of the surface that made the transaction. */
  readonly at: string;
  /** See {@link TxOrigin}. */
  readonly origin?: string;
}

/**
 * The durable sequence of committed transactions, owned by the store.
 *
 * It is the store's and not the log's because durability is the store's job
 * and nothing else can make the two writes one: the JSONL adapter appends
 * inside the `.lock` that already covers load → merge → replace, and the
 * SQLite adapter inserts inside the same `BEGIN IMMEDIATE` as the node rows.
 * A log that owned its own file beside the store would need its own lock, its
 * own crash story and its own rev allocation — three mechanisms for a
 * sequence the store is already serialising.
 *
 * Synchronous for the same reason {@link KbTxLog} is, and because both
 * adapters' primitives are synchronous underneath their Effect wrappers
 * (`writeSync`, `bun:sqlite`). `append` throws a `DomainError` when it cannot
 * persist; that is the only failure channel a synchronous member has, and it
 * is the same one `KbIndex` uses.
 *
 * **Not self-serialising.** The tail allocates a rev by reading its own head,
 * so two unsynchronised appenders could allocate the same one. The store
 * appends inside its own exclusion, which is what makes concurrent CLI / MCP
 * / `kb ui` writers safe; the only other appender is
 * {@link KbTxLog.append} in the single `kb ui` process that owns
 * `.kb/queries/`.
 */
export interface TxTail {
  /** The newest recorded rev; 0 when nothing is recorded. Survives reopen. */
  head(): number;

  /**
   * Whether {@link head} describes the store as it is now.
   *
   * False when the store moved without the tail: a process killed between the
   * node write and the append, or a writer that bypassed the log entirely (a
   * hand-edited `nodes.jsonl`, a `VACUUM`). Each entry carries the store's own
   * durable commit mark as of that append, so this is a comparison rather than
   * a guess — and it is the reason the write order is *nodes first, tail
   * second*: a tail that lags is detectable here and costs one snapshot, while
   * a tail that led would hand every replica a frame for a change the store
   * never made.
   */
  isCurrent(): boolean;

  /** Everything the tail still holds, oldest first. */
  entries(): KbTx[];

  /** Assign the next rev, persist the record, and return it. */
  append(ops: StoreTx, record: TxRecord): KbTx;

  /**
   * Replace the tail's contents with `txs`, revs and all.
   *
   * `kb store migrate` is the caller: the nodes move byte-identically between
   * backends, so the sequence that produced them moves with them and a client
   * holding a rev is not forced into a snapshot by an operation that changed
   * nothing it can see.
   */
  adopt(txs: readonly KbTx[]): void;
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

/** The origin the saved-query virtual set carries. See {@link KbTxLog.append}. */
export const VIRTUAL_ORIGIN = "virtual";
