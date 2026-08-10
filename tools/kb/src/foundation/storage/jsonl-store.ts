import { Effect, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { domainError, type DomainError } from "../errors.ts";
import type { KbNode } from "../model.ts";
import { bunFileSystemLayer } from "../platform.ts";
import { canonicalJson } from "./canonical.ts";
import { KbNodeSchema, nodeParseOptions } from "./node-schema.ts";
import type { EffectStore, Store, StoreTx } from "./store.ts";

/** Lock older than this is reclaimable even if pid is still alive (pid-reuse). */
export const COMMIT_LOCK_STALE_MS = 30_000;

/** Max time to wait for a live holder before failing `conflict`. */
export const COMMIT_LOCK_TIMEOUT_MS = 5_000;

const LOCK_RETRY = "10 millis" as const;

type LockOwner = {
  readonly v: 1;
  readonly pid: number;
  readonly token: string;
  readonly createdAt: number;
  /** Sidecar hard-link path kept until release for inode identity proof. */
  readonly ownerPath: string;
};

function mapFsError(err: { message?: string } | unknown): DomainError {
  const message =
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
      ? (err as { message: string }).message
      : String(err);
  return domainError("internal", message);
}

/** Structural PlatformError AlreadyExists — never match on message text. */
function isAlreadyExists(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const pe = err as Partial<PlatformError>;
  return (
    pe._tag === "PlatformError" &&
    typeof pe.reason === "object" &&
    pe.reason !== null &&
    (pe.reason as { _tag?: unknown })._tag === "AlreadyExists"
  );
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const pe = err as Partial<PlatformError>;
  return (
    pe._tag === "PlatformError" &&
    typeof pe.reason === "object" &&
    pe.reason !== null &&
    (pe.reason as { _tag?: unknown })._tag === "NotFound"
  );
}

function decodeKbNode(
  raw: unknown,
  label: string,
  details?: Record<string, unknown>,
): Effect.Effect<KbNode, DomainError> {
  return Schema.decodeUnknownEffect(
    KbNodeSchema,
    nodeParseOptions,
  )(raw).pipe(
    Effect.mapError((err) =>
      domainError("invalid_input", `invalid ${label}: ${err.message}`, {
        ...details,
        issue: err.issue,
      }),
    ),
    Effect.map((node) => node as KbNode),
  );
}

function decodeNodeLine(
  line: string,
  path: string,
  lineNo: number,
): Effect.Effect<KbNode, DomainError> {
  return Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => JSON.parse(line) as unknown,
      catch: (err) =>
        domainError(
          "invalid_input",
          `malformed JSONL at ${path}:${lineNo}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          { path, lineNo },
        ),
    });
    return yield* decodeKbNode(raw, `node at ${path}:${lineNo}`, {
      path,
      lineNo,
    });
  });
}

function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseLockOwner(body: string): Omit<LockOwner, "ownerPath"> | null {
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    if (
      raw.v !== 1 ||
      typeof raw.pid !== "number" ||
      typeof raw.token !== "string" ||
      typeof raw.createdAt !== "number"
    ) {
      return null;
    }
    return {
      v: 1,
      pid: raw.pid,
      token: raw.token,
      createdAt: raw.createdAt,
    };
  } catch {
    return null;
  }
}

function isStaleOwner(
  owner: Omit<LockOwner, "ownerPath">,
  now: number,
): boolean {
  if (!pidAlive(owner.pid)) return true;
  // Live pid past TTL: treat as pid-reuse / abandoned holder.
  return now - owner.createdAt > COMMIT_LOCK_STALE_MS;
}

function sameInode(
  a: { dev: number; ino: Option.Option<number> },
  b: { dev: number; ino: Option.Option<number> },
): boolean {
  return (
    a.dev === b.dev &&
    Option.isSome(a.ino) &&
    Option.isSome(b.ino) &&
    a.ino.value === b.ino.value
  );
}

/**
 * Atomic commit lock:
 * 1. Write full owner payload to a unique sidecar, then `link` it onto
 *    `lockPath` (content is never observed empty mid-create).
 * 2. Empty/unparseable lock bodies are treated as held — never deleted.
 * 3. Stale takeover renames the lock away (atomic; only one winner), then
 *    retries the link — cannot delete a live/reacquired lock by content guess.
 * 4. Release unlinks `lockPath` only when it still shares the sidecar inode.
 */
function acquireCommitLock(
  fs: FileSystem,
  lockPath: string,
): Effect.Effect<LockOwner, DomainError> {
  const token = randomUUID();
  const ownerPath = `${lockPath}.owner.${token}`;
  const record = {
    v: 1 as const,
    pid: process.pid,
    token,
    createdAt: Date.now(),
  };
  const payload = JSON.stringify(record);

  const cleanupOwner = fs
    .remove(ownerPath, { force: true })
    .pipe(Effect.ignore);

  return Effect.gen(function* () {
    yield* fs
      .writeFileString(ownerPath, payload)
      .pipe(Effect.mapError(mapFsError));

    const deadline = Date.now() + COMMIT_LOCK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const linked = yield* fs.link(ownerPath, lockPath).pipe(
        Effect.as(true as const),
        Effect.catch((err) =>
          isAlreadyExists(err)
            ? Effect.succeed(false as const)
            : Effect.fail(mapFsError(err)),
        ),
      );
      if (linked) {
        return { ...record, ownerPath };
      }

      const body = yield* fs
        .readFileString(lockPath)
        .pipe(Effect.catch(() => Effect.succeed("")));
      const current = parseLockOwner(body);
      // Unparseable/empty: holder still publishing or foreign format — wait.
      if (!current || !isStaleOwner(current, Date.now())) {
        yield* Effect.sleep(LOCK_RETRY);
        continue;
      }

      // Atomic stale claim: rename lock out of the well-known path.
      const stalePath = `${lockPath}.stale.${token}.${randomUUID()}`;
      const moved = yield* fs.rename(lockPath, stalePath).pipe(
        Effect.as(true as const),
        Effect.catch((err) =>
          isNotFound(err)
            ? Effect.succeed(false as const)
            : Effect.fail(mapFsError(err)),
        ),
      );
      if (moved) {
        yield* fs.remove(stalePath, { force: true }).pipe(Effect.ignore);
        continue;
      }
      yield* Effect.sleep(LOCK_RETRY);
    }

    return yield* Effect.fail(
      domainError("conflict", `commit lock timeout for ${lockPath}`, {
        lockPath,
      }),
    );
  }).pipe(
    Effect.tapError(() => cleanupOwner),
    Effect.onInterrupt(() => cleanupOwner),
  );
}

function releaseCommitLock(
  fs: FileSystem,
  lockPath: string,
  owner: LockOwner,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const lockStat = yield* fs
      .stat(lockPath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    const ownerStat = yield* fs
      .stat(owner.ownerPath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (
      lockStat !== null &&
      ownerStat !== null &&
      sameInode(lockStat, ownerStat)
    ) {
      // Still our inode at the well-known path — safe to release.
      yield* fs.remove(lockPath, { force: true }).pipe(Effect.ignore);
    }
    yield* fs.remove(owner.ownerPath, { force: true }).pipe(Effect.ignore);
  });
}

/**
 * JSONL backend: `<root>/.kb/nodes.jsonl`
 * One canonical-JSON node per line, sorted by id.
 * Commits are atomic (tmp + rename) and keep `nodes.jsonl.bak` of the prior file.
 *
 * Concurrent commits (multi-fiber, multi-JsonlStore instance, or multi-process
 * surfaces on the same path) are serialized by an exclusive
 * `nodes.jsonl.lock` acquired via write-then-link ownership (never an empty
 * wx create). Stale locks are reclaimed by rename-away, not blind unlink.
 * Upserts and the merged snapshot are schema-validated before any durable
 * write; invalid input fails with `invalid_input` and leaves the live file
 * untouched.
 *
 * Load is all-or-nothing: any malformed/invalid line fails the Effect with a
 * line-numbered DomainError and returns no nodes — the file is never rewritten
 * by load (compatible with the pre-Schema loader, which threw mid-parse).
 *
 * Effect-native I/O: {@link loadEffect}/{@link commitEffect} (yield* FileSystem).
 * Promise {@link load}/{@link commit} are public adapters for tests/context.
 */
export class JsonlStore implements Store, EffectStore {
  readonly path: string;
  readonly backupPath: string;
  readonly lockPath: string;

  constructor(root: string) {
    this.path = join(root, ".kb", "nodes.jsonl");
    this.backupPath = `${this.path}.bak`;
    this.lockPath = `${this.path}.lock`;
  }

  loadEffect(): Effect.Effect<KbNode[], DomainError, FileSystem> {
    const path = this.path;
    return Effect.gen(function* () {
      const fs = yield* FileSystem;
      const exists = yield* fs.exists(path).pipe(Effect.mapError(mapFsError));
      if (!exists) return [];

      const body = yield* fs
        .readFileString(path)
        .pipe(Effect.mapError(mapFsError));
      if (body.trim().length === 0) return [];

      // Accumulate only after every line validates — fail the whole load on the
      // first bad line (no partial KbNode[] for callers; no file mutation here).
      const nodes: KbNode[] = [];
      const lines = body.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.trim().length === 0) continue;
        nodes.push(yield* decodeNodeLine(line, path, i + 1));
      }
      return nodes;
    });
  }

  commitEffect(tx: StoreTx): Effect.Effect<void, DomainError, FileSystem> {
    const path = this.path;
    const backupPath = this.backupPath;
    const lockPath = this.lockPath;
    const loadEffect = this.loadEffect.bind(this);

    return Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem;

        // Directory must exist before lock sidecar + link.
        yield* fs
          .makeDirectory(dirname(path), { recursive: true })
          .pipe(Effect.mapError(mapFsError));

        yield* Effect.acquireRelease(
          acquireCommitLock(fs, lockPath),
          (owner) => releaseCommitLock(fs, lockPath, owner),
          { interruptible: true },
        );

        const upserts: KbNode[] = [];
        for (let i = 0; i < tx.upserts.length; i++) {
          upserts.push(
            yield* decodeKbNode(tx.upserts[i], `upsert[${i}]`, {
              index: i,
            }),
          );
        }

        const existing = yield* loadEffect();
        const byId = new Map(existing.map((n) => [n.id, n]));
        for (const id of tx.deletes) byId.delete(id);
        for (const node of upserts) byId.set(node.id, node);

        const sorted = [...byId.values()].sort((a, b) =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        );
        for (let i = 0; i < sorted.length; i++) {
          yield* decodeKbNode(sorted[i], `snapshot[${i}]`, { index: i });
        }

        const body =
          sorted.length === 0
            ? ""
            : sorted.map((n) => canonicalJson(n)).join("\n") + "\n";

        const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
        yield* Effect.acquireRelease(
          Effect.succeed(tmp),
          (p) => fs.remove(p, { force: true }).pipe(Effect.ignore),
        );

        yield* fs.writeFileString(tmp, body).pipe(Effect.mapError(mapFsError));

        const hadPrior = yield* fs
          .exists(path)
          .pipe(Effect.mapError(mapFsError));
        if (hadPrior) {
          yield* fs
            .copyFile(path, backupPath)
            .pipe(Effect.mapError(mapFsError));
        }

        yield* fs.rename(tmp, path).pipe(Effect.mapError(mapFsError));
      }),
    );
  }

  load(): Promise<KbNode[]> {
    return Effect.runPromise(
      this.loadEffect().pipe(Effect.provide(bunFileSystemLayer)),
    );
  }

  commit(tx: StoreTx): Promise<void> {
    return Effect.runPromise(
      this.commitEffect(tx).pipe(Effect.provide(bunFileSystemLayer)),
    );
  }
}

/** Promise facade over any {@link EffectStore} (e.g. in-memory test doubles). */
export function asPromiseStore(store: EffectStore): Store {
  return {
    path: store.path,
    load: () =>
      Effect.runPromise(
        store.loadEffect().pipe(Effect.provide(bunFileSystemLayer)),
      ),
    commit: (tx) =>
      Effect.runPromise(
        store.commitEffect(tx).pipe(Effect.provide(bunFileSystemLayer)),
      ),
  };
}
