import type { Effect, Stream } from "effect";
import { domainError, type DomainError, type KbNode, type StoreTx } from "@kb/model";
import type { TxRecord, TxTail } from "./tx-log.ts";

/**
 * What the store looked like at one moment, as a value a session can hold and
 * compare. Opaque on purpose: callers ask "is this the store I last saw?", and
 * only the store knows what makes that true — {@link JsonlStore} hashes the
 * file's bytes, the SQLite store reads the change counter its triggers keep.
 * It names the state, not the reader: every instance over one root gives one
 * state one name, so a fingerprint read in one process is a condition another
 * can commit on. A string because equality is the whole interface.
 */
export type StoreFingerprint = string;

/**
 * What one commit did.
 *
 * A store commits by merging: it reads the current state inside its own
 * exclusion, applies the transaction, and writes the result. So the state a
 * commit merged into is not necessarily the state its caller last read —
 * another process may have written in between, and that write is now in the
 * store whether the caller knows about it or not.
 *
 * `base` is what the commit actually merged into. A caller that had seen
 * exactly that can apply its own delta to its index; a caller that had not
 * has an index missing whatever the commit absorbed, and must reload. Null
 * means the store cannot say, which compares equal to nothing — the safe
 * direction, since it costs a reload and never a stale index.
 */
export interface StoreCommit {
  readonly base: StoreFingerprint | null;
  /** The store's fingerprint after the write. */
  readonly fingerprint: StoreFingerprint | null;
  /**
   * The transaction as the store applied it: the caller's `tx` passed through
   * `@kb/model`'s `rankTx` against the state it merged into, so every sibling
   * group it touched is well ranked (DESIGN.md → Sibling ranks). This is what
   * the tail recorded, and what a caller's index applies — never its own `tx`,
   * which may lack the ranks the store settled.
   */
  readonly tx: StoreTx;
}

/**
 * Effect-native persistence port. A port that leaks its adapter's platform
 * into R is not a port: the concrete store provides its own FileSystem, so a
 * consumer of {@link EffectStore} needs nothing but the store. `loadEffect` is
 * a value, not a nullary function — an Effect is already the deferred call.
 */
export interface EffectStore {
  readonly path: string;
  /**
   * The store's state as it moves, whoever moves it: the current
   * {@link fingerprint} once the subscription is armed, then each fingerprint
   * that differs from the last one emitted. Running the stream is the
   * subscription; interrupting it releases whatever the adapter holds.
   *
   * A commit by another instance over the same root — another process, a
   * hand edit — is observed without anyone asking. This instance's own
   * commits appear too when the platform reports them, and a consumer treats
   * that as a no-op: the commit's {@link StoreCommit} already said what it
   * did. The stream reports states, never writers.
   *
   * On the port because noticing an external write is a store property, like
   * reading and committing: how it is noticed (which files, which events) is
   * the adapter's layout, and a consumer that named files would be the port
   * leaking. The guarantee is stated once, in `DESIGN.md` → Storage, and
   * proved for every adapter by the store contract.
   */
  readonly changes: Stream.Stream<StoreFingerprint | null>;
  readonly loadEffect: Effect.Effect<KbNode[], DomainError>;
  /**
   * The store's current fingerprint, or null when it cannot say (no store
   * written yet, or the backend has no cheap answer). Null never compares
   * equal to anything, so a session that gets one reloads.
   */
  readonly fingerprint: Effect.Effect<StoreFingerprint | null>;
  /**
   * The durable sequence of transactions this store has committed.
   *
   * On the store because only the store can make the node write and the log
   * record one act — see {@link TxTail}. It is read and appended
   * synchronously, and it is what a session's {@link KbTxLog} is a view of.
   */
  readonly txTail: TxTail;
  /**
   * Apply `tx`, record it on {@link txTail}, and report what the store did so
   * a caller can tell its own delta from the state that delta landed in. See
   * {@link StoreCommit}.
   *
   * Ranks are settled here, inside the adapter's exclusion: `tx` is passed
   * through `rankTx` against the state it merges into before anything is
   * written, so a node committed without a rank gets one and two writers that
   * appended from the same read never leave siblings sharing a rank.
   *
   * `record` is the caller's half of the log entry — the rev is the tail's to
   * assign. It is required rather than optional because a commit nobody
   * recorded is exactly the hole this port used to have: the transaction
   * existed, the store wrote it, and no reader could ever learn what it was.
   * An empty `tx` is not recorded (it costs a rev and a frame and says
   * nothing), so a commit whose only purpose is to create the store leaves the
   * tail alone.
   *
   * `expected` makes the commit conditional: it lands only if the state it
   * would merge into is the one `expected` names, checked inside the same
   * exclusion as the write — see {@link staleCommitError}. Without it the
   * commit merges into whatever is there, which is what a session that
   * reconciles through {@link StoreCommit.base} wants; with it a caller that
   * decided on a state it read gets "that state is gone" instead of a merge.
   */
  commitEffect(
    tx: StoreTx,
    record: TxRecord,
    expected?: StoreFingerprint,
  ): Effect.Effect<StoreCommit, DomainError>;
}

/**
 * The one test of a conditional commit, shared by every adapter so the rule
 * cannot drift between them: no `expected` always passes, and otherwise the
 * state the commit would merge into must be exactly the named one. A store
 * that cannot name its state (`base` null) matches nothing — the safe
 * direction, since it costs the caller a re-read and never a blind write. The
 * failure is a `conflict`, and the adapter writes and records nothing.
 */
export function staleCommitError(
  expected: StoreFingerprint | undefined,
  base: StoreFingerprint | null,
): DomainError | null {
  if (expected === undefined || (base !== null && base === expected)) return null;
  return domainError("conflict", "store changed since it was read; read again before committing", {
    expected,
    actual: base,
  });
}
