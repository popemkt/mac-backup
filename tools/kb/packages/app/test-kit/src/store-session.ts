/**
 * What the store contract's properties share: an adapter factory, a scratch
 * root the scope releases, a session opened the way every surface opens one,
 * and the store's observable state. Split out of `store-contract.ts` so a
 * property that needs a file of its own (`view-migration-contract.ts`) uses
 * the same helpers rather than a copy.
 */
import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EffectStore, KbContext } from "@kb/contracts";
import { canonicalJsonl, type DomainError } from "@kb/model";
import { bunFileSystemLayer, openKbEffect } from "@kb/runtime";

/** How the suite gets an adapter under test for a scratch root. */
export type StoreFactory = (root: string) => EffectStore;

/** The stamp every contract commit carries, so nothing reads the wall clock. */
export const CONTRACT_AT = "2026-01-01T00:00:00.000Z";

/** A fresh root, removed when the scope that acquired it closes. */
export const scratchRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "kb-store-contract-"))),
  (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
);

/** Open a session the way every surface does: select by presence, seed if new. */
export function openSession(root: string): Effect.Effect<KbContext, DomainError> {
  return openKbEffect(root).pipe(Effect.provide(bunFileSystemLayer));
}

/** A root the factory's backend owns, so opening it selects that backend. */
export const backendRoot = Effect.fn("storeContract.backendRoot")(function* (
  makeStore: StoreFactory,
) {
  const root = yield* scratchRoot;
  yield* makeStore(root).commitEffect({ upserts: [], deletes: [] }, { at: CONTRACT_AT });
  return root;
});

interface StoreState {
  readonly nodes: string;
  readonly fingerprint: string | null;
  readonly tail: number;
}

/** What a store shows of itself: its nodes, its name, and how long its tail is. */
export const stateOf = Effect.fn("storeContract.stateOf")(function* (store: EffectStore) {
  const state: StoreState = {
    nodes: canonicalJsonl(yield* store.loadEffect),
    fingerprint: yield* store.fingerprint,
    tail: store.txTail.entries().length,
  };
  return state;
});
