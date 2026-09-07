/**
 * Which store a root has, and how to move between them.
 *
 * The composition root is the one place entitled to know that more than one
 * `EffectStore` adapter exists — every layer above it holds the port. So the
 * table of backends lives here, and everything that has to name a concrete
 * adapter (selection, `kb init --store`, migration) reads that one table
 * rather than branching on a backend name at its own call site.
 */
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import { currentIso, domainError, ensureDomainError, type DomainError } from "@kb/model";
import type { EffectStore } from "@kb/contracts";
import { JsonlStore } from "@kb/store-jsonl";
import { SqliteStore, sqliteStoreFiles } from "@kb/store-sqlite";

/** The backends a root can be stored in. Also the `--store` / `--to` values. */
export const STORE_BACKENDS = ["jsonl", "sqlite"] as const;
export type StoreBackend = (typeof STORE_BACKENDS)[number];

/** An open store plus the way to let go of whatever it holds. */
interface OpenedStore {
  readonly store: EffectStore;
  /** No-op for a backend that holds nothing; a connection close for sqlite. */
  readonly release: () => void;
}

interface StoreBackendOps {
  readonly open: (root: string) => OpenedStore;
  /** Every file the backend owns under a root; the selecting one first. */
  readonly files: (root: string) => readonly string[];
}

/**
 * Erase a concrete adapter into {@link StoreBackendOps} while `release` still
 * sees its real type — so the table needs no cast and no `instanceof`.
 */
function backend<S extends EffectStore>(spec: {
  make: (root: string) => S;
  files: (root: string) => readonly string[];
  release?: (store: S) => void;
}): StoreBackendOps {
  return {
    files: spec.files,
    open: (root) => {
      const store = spec.make(root);
      return { store, release: () => spec.release?.(store) };
    },
  };
}

const BACKENDS: Record<StoreBackend, StoreBackendOps> = {
  jsonl: backend({
    make: (root) => new JsonlStore(root),
    // The store itself names its files — including its transaction tail, which
    // is as much the store's as `nodes.jsonl` is and must go when it goes, or
    // migrating away would leave a tail describing a store that is not there.
    // `.lock` and `.tmp` are transient.
    files: (root) => {
      const store = new JsonlStore(root);
      return [store.path, store.backupPath, store.txTail.path, store.txTail.backupPath];
    },
  }),
  sqlite: backend({
    make: (root) => new SqliteStore(root),
    files: sqliteStoreFiles,
    release: (store) => store.close(),
  }),
};

/** The path whose existence means "this root is stored in that backend". */
function selectingPath(root: string, name: StoreBackend): string {
  const [first] = BACKENDS[name].files(root);
  return first ?? join(root, ".kb");
}

const presentBackends = Effect.fn("kb.presentBackends")(function* (
  root: string,
): Effect.fn.Return<readonly StoreBackend[], DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const found: StoreBackend[] = [];
  for (const name of STORE_BACKENDS) {
    const exists = yield* fs
      .exists(selectingPath(root, name))
      .pipe(Effect.mapError(ensureDomainError));
    if (exists) found.push(name);
  }
  return found;
});

function twoStoresError(root: string, found: readonly StoreBackend[]): DomainError {
  const paths = found.map((name) => selectingPath(root, name));
  return domainError(
    "conflict",
    `two stores under ${root}: ${paths.join(" and ")}. Keep one — ` +
      `nothing can say which is authoritative, and a precedence rule would ` +
      `silently strand the other's writes.`,
    { root, paths },
  );
}

/**
 * The store this root has: sqlite when `.kb/kb.sqlite` is there, JSONL
 * otherwise, and a refusal when both are. Presence rather than configuration —
 * the answer is one bit, and a config key that disagreed with the tree would
 * be a second source of truth for which store is real.
 */
export const selectStore = Effect.fn("kb.selectStore")(function* (
  root: string,
): Effect.fn.Return<EffectStore, DomainError, FileSystem> {
  const found = yield* presentBackends(root);
  if (found.length > 1) return yield* twoStoresError(root, found);
  const [name = "jsonl"] = found;
  return BACKENDS[name].open(root).store;
});

/**
 * Make an empty store of `name` under a root that has none — what
 * `kb init --store` does before the session opens and seeds. A root that
 * already has a store keeps it; asking for a different one is the refusal
 * {@link migrateStore} exists for.
 */
export const createStore = Effect.fn("kb.createStore")(function* (
  root: string,
  name: StoreBackend,
): Effect.fn.Return<void, DomainError, FileSystem> {
  const found = yield* presentBackends(root);
  if (found.length > 1) return yield* twoStoresError(root, found);
  const [existing] = found;
  if (existing === name) return undefined;
  if (existing !== undefined) {
    return yield* domainError(
      "conflict",
      `${root} is already a ${existing} store; use \`kb store migrate --to ${name}\``,
      { root, existing, requested: name },
    );
  }
  const opened = BACKENDS[name].open(root);
  yield* opened.store.commitEffect({ upserts: [], deletes: [] }, { at: yield* currentIso });
  opened.release();
  return undefined;
});

export interface StoreMigration {
  from: StoreBackend;
  to: StoreBackend;
  nodes: number;
  path: string;
}

/**
 * Move a root from the store it has to the one it asked for: load everything,
 * commit it into the other backend, carry the transaction tail across, then
 * remove the source's files.
 *
 * The removal is the point. Selection is by presence, so leaving the old files
 * behind would leave the root in exactly the state the selector refuses to
 * read — the migration is not finished until only one store is there.
 */
export const migrateStore = Effect.fn("kb.migrateStore")(function* (
  root: string,
  to: StoreBackend,
): Effect.fn.Return<StoreMigration, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const found = yield* presentBackends(root);
  if (found.length > 1) return yield* twoStoresError(root, found);

  const [from] = found;
  if (from === undefined) {
    return yield* domainError("not_found", `no kb store under ${root}`, { root });
  }
  if (from === to) {
    return yield* domainError("conflict", `${root} is already a ${to} store`, { root, to });
  }

  const source = BACKENDS[from].open(root);
  const target = BACKENDS[to].open(root);
  const nodes = yield* source.store.loadEffect;
  const tail = source.store.txTail.entries();
  yield* target.store.commitEffect({ upserts: nodes, deletes: [] }, { at: yield* currentIso });
  // The tail moves with the nodes, revs and all. The migration changes nothing
  // a client can see, so it must not be the thing that forces every client
  // into a snapshot — and `adopt` re-stamps the store mark, because the marks
  // in the source tail describe a store that is about to be deleted. It runs
  // after the node commit so the mark it stamps is the target's settled one.
  // A source with no tail (a store written before tails existed) leaves the
  // target the one record its own commit made, which is the truthful answer:
  // the whole graph arrived in one transaction and nothing before it is known.
  if (tail.length > 0) target.store.txTail.adopt(tail);

  // Release before removing: a backend that holds a file open would otherwise
  // recreate its sidecars on close, and the root would have two stores again.
  source.release();
  for (const file of BACKENDS[from].files(root)) {
    yield* fs.remove(file, { force: true }).pipe(Effect.mapError(ensureDomainError));
  }
  const path = target.store.path;
  target.release();

  return { from, to, nodes: nodes.length, path };
});
