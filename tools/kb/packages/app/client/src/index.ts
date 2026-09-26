import { Cause, Effect, Exit, Schema } from "effect";
import { staleCommitError, type EffectStore } from "@kb/contracts";
import {
  applyTx,
  byNodeId,
  currentIso,
  domainError,
  isDomainError,
  KbNodeSchema,
  nodeParseOptions,
  txIntegrityError,
  type DomainError,
} from "@kb/model";
import { DatascriptIndex, type KbIndex } from "@kb/query";
import { selectStore, bunFileSystemLayer } from "@kb/runtime";
import type { KbClient, QueryResult, Snapshot } from "./api.d.ts";

export type { Commit, KbClient, KbNode, PropValue, QueryResult, Snapshot } from "./api.d.ts";

export class KbClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "KbClientError";
    this.code = code;
  }
}

/** Unknown node keys are preserved, as they are on every other path into the store. */
const decodeCommit = Schema.decodeUnknownEffect(
  Schema.Struct({
    expectedRevision: Schema.NonEmptyString,
    upserts: Schema.mutable(Schema.Array(KbNodeSchema)),
    deletes: Schema.mutable(Schema.Array(Schema.String)),
    origin: Schema.optionalKey(Schema.String),
  }),
  nodeParseOptions,
);

/** Reads that see a writer land mid-read retry; this many in a row is a busy store. */
const SNAPSHOT_ATTEMPTS = 8;

/**
 * Nodes and the fingerprint that names them. The port reads the two
 * separately, so the fingerprint is taken on both sides of the load: equal
 * means no write landed in between, and the nodes are exactly that state.
 */
const readSnapshot = Effect.fn("kb.client.snapshot")(function* (
  store: EffectStore,
): Effect.fn.Return<Snapshot, DomainError> {
  for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt++) {
    const before = yield* store.fingerprint;
    const nodes = yield* store.loadEffect;
    const after = yield* store.fingerprint;
    if (before === null && after === null) {
      return yield* domainError("internal", `store at ${store.path} cannot name its state`);
    }
    if (before === after && before !== null) {
      return { revision: before, nodes: nodes.toSorted(byNodeId) };
    }
  }
  return yield* domainError("conflict", "store kept changing while it was read; try again");
});

/**
 * The client's one {@link KbIndex} and the revision it holds. `null` while no
 * state is held: before the first query, and across a rebuild.
 */
interface HeldIndex {
  readonly index: KbIndex;
  revision: string | null;
}

/**
 * One fingerprint read decides whether the held index still names the
 * store's state; only when it does not is a snapshot read and the index
 * rebuilt. The rebuild, the query and the revision reported with the rows
 * share one synchronous block, so the two always describe the same state,
 * even when another query rebuilt the index in between.
 */
const runQuery = Effect.fn("kb.client.query")(function* (
  store: EffectStore,
  held: HeldIndex,
  edn: string,
  inputs: readonly unknown[],
): Effect.fn.Return<QueryResult, DomainError> {
  const fingerprint = yield* store.fingerprint;
  const fresh =
    fingerprint !== null && fingerprint === held.revision ? null : yield* readSnapshot(store);
  const result = yield* Effect.try({
    try: (): QueryResult | null => {
      if (fresh !== null) {
        held.revision = null;
        held.index.rebuild(fresh.nodes);
        held.revision = fresh.revision;
      }
      const revision = held.revision;
      return revision === null ? null : { revision, rows: held.index.runDatalog(edn, ...inputs) };
    },
    catch: (err) => domainError("invalid_input", err instanceof Error ? err.message : String(err)),
  });
  if (result === null) {
    return yield* domainError("internal", `the index for ${store.path} holds no state`);
  }
  return result;
});

/**
 * Validate the batch against the state it was decided on, then commit it on
 * the condition that the store is still there. The early staleness check only
 * spares a doomed integrity pass; the store's own check, inside its
 * exclusion, is the one that makes the result exact — which is also why the
 * committed snapshot is the read state with this batch applied.
 */
const commitChange = Effect.fn("kb.client.commit")(function* (
  store: EffectStore,
  change: unknown,
): Effect.fn.Return<Snapshot, DomainError> {
  const input = yield* decodeCommit(change).pipe(
    Effect.mapError((err) => domainError("invalid_input", err.message)),
  );
  const current = yield* readSnapshot(store);
  const stale = staleCommitError(input.expectedRevision, current.revision);
  if (stale !== null) return yield* stale;

  const tx = { upserts: input.upserts, deletes: input.deletes };
  const invalid = txIntegrityError(current.nodes, tx);
  if (invalid !== null) {
    return yield* domainError("invalid_input", `invalid graph transaction: ${invalid}`);
  }
  const at = yield* currentIso;
  const record = input.origin === undefined ? { at } : { at, origin: input.origin };
  const { fingerprint, tx: applied } = yield* store.commitEffect(tx, record, current.revision);
  if (fingerprint === null) {
    return yield* domainError("internal", `store at ${store.path} cannot name its state`);
  }
  return {
    revision: fingerprint,
    nodes: [...applyTx(current.nodes, applied).values()].toSorted(byNodeId),
  };
});

/** Failures cross the package boundary as {@link KbClientError}, never as Effect values. */
function run<A>(effect: Effect.Effect<A, DomainError>): Promise<A> {
  return Effect.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    const failure = Cause.squash(exit.cause);
    throw isDomainError(failure)
      ? new KbClientError(failure.code, failure.message)
      : new KbClientError("internal", failure instanceof Error ? failure.message : String(failure));
  });
}

function clientOver(store: EffectStore): KbClient {
  const held: HeldIndex = { index: new DatascriptIndex(), revision: null };
  return {
    snapshot: () => run(readSnapshot(store)),
    query: (edn, inputs = []) => run(runQuery(store, held, edn, inputs)),
    commit: (change) => run(commitChange(store, change)),
  };
}

/**
 * The store is chosen once, the way every kb surface chooses it
 * (`selectStore`: by which store file is present), and held for the client's
 * lifetime — a sqlite store keeps its connection open until the process ends.
 */
export function openClient(root: string): Promise<KbClient> {
  return run(selectStore(root).pipe(Effect.map(clientOver), Effect.provide(bunFileSystemLayer)));
}
