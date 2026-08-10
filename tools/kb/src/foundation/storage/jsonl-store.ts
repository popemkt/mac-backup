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

/**
 * Documented bound only — NOT used to steal live-pid locks.
 * A hung-but-alive holder wedges waiters until {@link COMMIT_LOCK_TIMEOUT_MS}.
 * A dead pid reused by an unrelated process likewise waits out the timeout.
 */
export const COMMIT_LOCK_STALE_MS = 30_000;

/** Max time for one acquire attempt before `conflict` (retryable). */
export const COMMIT_LOCK_TIMEOUT_MS = 15_000;

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

/** Stale ⇔ dead pid only. Never steal a live holder (TTL is documentation only). */
export function isStaleOwner(owner: { pid: number }): boolean {
  return !pidAlive(owner.pid);
}

export function sameInode(
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

/** True when lockPath still carries our unique token (content identity). */
export function ownsCommitLock(
  fs: FileSystem,
  lockPath: string,
  token: string,
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const body = yield* fs
      .readFileString(lockPath)
      .pipe(Effect.catch(() => Effect.succeed("")));
    const cur = parseLockOwner(body);
    return cur?.token === token;
  });
}

/**
 * Dead-pid takeover with content-verified rename.
 * After rename, the quarantine body must byte-equal the body observed at
 * decision time (ABA-proof vs inode reuse). On mismatch, restore only if
 * lockPath is vacant.
 */
export function claimStaleLock(
  fs: FileSystem,
  lockPath: string,
  observedBody: string,
  token: string,
): Effect.Effect<boolean, DomainError> {
  return Effect.gen(function* () {
    const quarantine = `${lockPath}.quarantine.${token}.${randomUUID()}`;
    const moved = yield* fs.rename(lockPath, quarantine).pipe(
      Effect.as(true as const),
      Effect.catch((err) =>
        isNotFound(err)
          ? Effect.succeed(false as const)
          : Effect.fail(mapFsError(err)),
      ),
    );
    if (!moved) return false;

    const qBody = yield* fs
      .readFileString(quarantine)
      .pipe(Effect.catch(() => Effect.succeed("")));
    if (qBody === observedBody) {
      yield* fs.remove(quarantine, { force: true }).pipe(Effect.ignore);
      return true;
    }

    // Content mismatch: ABA reuse or a fresh lock was swapped in.
    const lockExists = yield* fs
      .exists(lockPath)
      .pipe(Effect.catch(() => Effect.succeed(true)));
    if (!lockExists) {
      yield* fs
        .rename(quarantine, lockPath)
        .pipe(Effect.catch(() => Effect.void));
    } else {
      // Occupied by a live/fresh holder — drop quarantine only (dead content).
      yield* fs.remove(quarantine, { force: true }).pipe(Effect.ignore);
    }
    return false;
  });
}

/**
 * Atomic commit lock (consult-r3 protocol):
 * 1. Write full owner payload to a unique sidecar, then `link` onto lockPath
 *    (link is the sole name creator; body never empty mid-create).
 * 2. Empty/unparseable lock bodies are held — never deleted.
 * 3. Stale ⇔ dead pid only; takeover is content-verified rename + restore-if-vacant.
 * 4. Release unlinks lockPath only while it still shares the sidecar inode.
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
    while (true) {
      const linked = yield* fs.link(ownerPath, lockPath).pipe(
        Effect.as(true as const),
        Effect.catch((err) =>
          isAlreadyExists(err)
            ? Effect.succeed(false as const)
            : Effect.fail(mapFsError(err)),
        ),
      );
      if (linked) {
        const stillOurs = yield* ownsCommitLock(fs, lockPath, token);
        if (stillOurs) return { ...record, ownerPath };
        // Lost between link and check — wait and retry (do not self-deadlock).
        if (Date.now() > deadline) break;
        yield* Effect.sleep(LOCK_RETRY);
        continue;
      }

      const curBody = yield* fs
        .readFileString(lockPath)
        .pipe(Effect.catch(() => Effect.succeed("")));
      const cur = parseLockOwner(curBody);
      // Live, unknown, or unparseable ⇒ never steal (INV3).
      if (!cur || !isStaleOwner(cur)) {
        if (Date.now() > deadline) break;
        yield* Effect.sleep(LOCK_RETRY);
        continue;
      }

      const claimed = yield* claimStaleLock(fs, lockPath, curBody, token);
      if (!claimed) {
        if (Date.now() > deadline) break;
        yield* Effect.sleep(LOCK_RETRY);
      }
      // Claimed: name vacant — retry link immediately.
    }

    return yield* Effect.fail(
      domainError("conflict", `commit lock timeout for ${lockPath}`, {
        lockPath,
        retryable: true,
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
    // INV2: unlink the well-known name only while it is still our inode;
    // sidecar stays alive until after that unlink (prevents inode reuse).
    if (
      lockStat !== null &&
      ownerStat !== null &&
      sameInode(lockStat, ownerStat)
    ) {
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
 * Concurrent commits serialize via write-then-`link` ownership of
 * `nodes.jsonl.lock`. Stale ⇔ dead pid only (never steal a live holder).
 * Takeover is content-verified rename with restore-if-vacant. Upserts and the
 * merged snapshot are schema-validated before any durable write.
 *
 * Load is all-or-nothing: any malformed/invalid line fails the Effect with a
 * line-numbered DomainError and returns no nodes — the file is never rewritten
 * by load.
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
    const maxAttempts = 4;

    const attemptOnce = Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem;

        yield* fs
          .makeDirectory(dirname(path), { recursive: true })
          .pipe(Effect.mapError(mapFsError));

        yield* Effect.acquireRelease(
          acquireCommitLock(fs, lockPath),
          (owner) => releaseCommitLock(fs, lockPath, owner),
          { interruptible: true },
        );

        // INV1: dead-pid-only stale means no live peer can be mid-section.
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

    return Effect.gen(function* () {
      let last: DomainError | null = null;
      for (let i = 0; i < maxAttempts; i++) {
        const outcome = yield* Effect.result(attemptOnce);
        if (outcome._tag === "Success") return;
        last = outcome.failure;
        const retryable =
          last.code === "conflict" &&
          typeof last.details === "object" &&
          last.details !== null &&
          (last.details as { retryable?: unknown }).retryable === true;
        if (!retryable) return yield* Effect.fail(last);
        yield* Effect.sleep(LOCK_RETRY);
      }
      return yield* Effect.fail(
        last ??
          domainError(
            "conflict",
            `commit lock retries exhausted for ${lockPath}`,
            { lockPath, retryable: true },
          ),
      );
    });
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
