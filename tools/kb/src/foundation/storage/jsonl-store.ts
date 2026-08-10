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

/** Suffix of the fixed stale-break breaker vote file (`nodes.jsonl.lock.break`). */
const BREAKER_SUFFIX = ".break";

type LockOwner = {
  readonly v: 1;
  readonly pid: number;
  readonly token: string;
  readonly createdAt: number;
  /** Sidecar hard-link path kept until release for inode identity proof. */
  readonly ownerPath: string;
};

type LockBreaker = {
  readonly v: 1;
  /** The dead lock body (byte-identical) this breaker vote targets. */
  readonly lock: string;
  readonly pid: number;
  readonly token: string;
  readonly createdAt: number;
  /** Sidecar path the breaker was linked from. */
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

function parseLockBreaker(body: string): Omit<LockBreaker, "ownerPath"> | null {
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    if (
      raw.v !== 1 ||
      typeof raw.lock !== "string" ||
      typeof raw.pid !== "number" ||
      typeof raw.token !== "string" ||
      typeof raw.createdAt !== "number"
    ) {
      return null;
    }
    return {
      v: 1,
      lock: raw.lock,
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
 * Dead-pid stale-break via an exclusive breaker vote (race-free protocol).
 *
 * The well-known `lockPath` name is ONLY ever created by atomic `link` and
 * removed by `unlink`. A stale reaper never renames anything onto `lockPath`
 * and never unlinks it directly: it first acquires a FIXED breaker name
 * (`${lockPath}.break`) by `link`ing a fully-written sidecar — the same
 * write-then-link discipline as the lock itself, so the breaker body is never
 * observed empty. `link` is the sole breaker arbiter: exactly one reaper holds
 * the breaker at a time, and only the breaker holder may unlink `lockPath`.
 *
 * Invariants:
 * - INV-B1 (sole unlinker): only the breaker holder removes `lockPath`, after
 *   re-reading it and requiring byte-identical content to the dead body it
 *   observed at decision time. Content is immutable once linked (owner
 *   sidecars are written once, then linked), so a byte-equal re-read proves
 *   the well-known name still names the dead lock.
 * - INV-B2 (no live detach): a live holder's lock is never unlinked. It can
 *   only be removed by its own release (INV2) or by a breaker holder whose
 *   verify passed — which requires the content to equal the observed dead
 *   body, impossible for a live lock (live pid ⇒ never classified stale).
 * - INV-B3 (delayed decision): a reaper whose decision-time body is stale
 *   (the dead lock was replaced before it linked the breaker) re-reads
 *   `lockPath`, finds a foreign/live body, and aborts without touching it;
 *   the finalizer drops its breaker.
 * - INV-B4 (breaker reclaim): an existing breaker is only ever removed when
 *   its holder pid is dead (`!pidAlive`) or it references a lock body that no
 *   longer matches the observer's — both provably not an active live breaker.
 *   A crashed holder's orphan breaker (dead pid) is reclaimed on the next
 *   reaper attempt; a suspended-but-alive holder is never reclaimed (no TTL),
 *   so no reclaim can race a legitimate hold. A dead pid reused by an
 *   unrelated process wedges reapers until the bounded acquire timeout
 *   (`conflict`, retryable) — the same documented liveness bound as the lock.
 * - INV-B5 (ABA): identity is content, never inode; the breaker is a vote
 *   file, not a hard link, and content re-verification happens immediately
 *   before the unlink. The only processes that can change `lockPath` are
 *   `link`-creators (name occupied, cannot) and the sole breaker holder (us,
 *   alive, not reclaimed), so the verify→unlink gap cannot be exploited.
 *
 * Returns `true` when the dead lock was removed (name vacant — caller retries
 * its `link` immediately); `false` otherwise (caller re-reads and retries).
 */
export function claimStaleLock(
  fs: FileSystem,
  lockPath: string,
  observedBody: string,
): Effect.Effect<boolean, DomainError> {
  const token = randomUUID();
  const breakerPath = `${lockPath}${BREAKER_SUFFIX}`;
  const breakerOwnerPath = `${breakerPath}.${token}`;
  const record = {
    v: 1 as const,
    lock: observedBody,
    pid: process.pid,
    token,
    createdAt: Date.now(),
  };
  const payload = JSON.stringify(record);

  let held = false;
  const removeSidecar = fs
    .remove(breakerOwnerPath, { force: true })
    .pipe(Effect.ignore);
  const removeBreaker = () =>
    held
      ? fs.remove(breakerPath, { force: true }).pipe(Effect.ignore)
      : Effect.void;

  return Effect.gen(function* () {
    yield* fs
      .writeFileString(breakerOwnerPath, payload)
      .pipe(Effect.mapError(mapFsError));

    const got = yield* fs.link(breakerOwnerPath, breakerPath).pipe(
      Effect.as(true as const),
      Effect.catch((err) =>
        isAlreadyExists(err)
          ? Effect.succeed(false as const)
          : Effect.fail(mapFsError(err)),
      ),
    );
    if (got) {
      held = true;
      // Sole breaker holder: re-read the well-known lock and require the
      // exact dead body observed at decision time (INV-B1/INV-B3).
      const current = yield* fs
        .readFileString(lockPath)
        .pipe(Effect.catch(() => Effect.succeed("")));
      if (current !== observedBody) {
        yield* removeBreaker();
        yield* removeSidecar;
        return false;
      }
      yield* fs.remove(lockPath, { force: true }).pipe(Effect.ignore);
      yield* removeBreaker();
      yield* removeSidecar;
      return true;
    }

    // EEXIST — another reaper holds the breaker. Inspect it (INV-B4).
    const holderBody = yield* fs
      .readFileString(breakerPath)
      .pipe(Effect.catch(() => Effect.succeed("")));
    const holder = parseLockBreaker(holderBody);
    if (
      holder &&
      (!pidAlive(holder.pid) || holder.lock !== observedBody)
    ) {
      // Stale vote: holder died mid-break, or it references a lock body that
      // no longer matches the current dead lock (its byte re-verify can only
      // fail when it resumes). Drop the vote; caller re-reads + retries.
      yield* fs.remove(breakerPath, { force: true }).pipe(Effect.ignore);
    }
    yield* removeSidecar;
    return false;
  }).pipe(
    Effect.tapError(() => removeSidecar),
    Effect.onInterrupt(() =>
      Effect.all([removeBreaker(), removeSidecar]),
    ),
  );
}

/**
 * Atomic commit lock:
 * 1. Write full owner payload to a unique sidecar, then `link` onto lockPath
 *    (link is the sole name creator; body never empty mid-create).
 * 2. Empty/unparseable lock bodies are held — never deleted.
 * 3. Stale ⇔ dead pid only; stale break is via the exclusive breaker protocol
 *    (see {@link claimStaleLock}) — never renames onto or unlinks a lock it
 *    cannot prove dead at removal time.
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

      const broken = yield* claimStaleLock(fs, lockPath, curBody);
      if (broken) continue; // dead lock removed — name vacant, retry link now
      if (Date.now() > deadline) break;
      yield* Effect.sleep(LOCK_RETRY);
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
 * Dead-pid stale break uses an exclusive breaker vote: the well-known name is
 * only ever created by `link` and removed by its owner or by the sole breaker
 * holder after a byte-identical dead-body re-verify. Upserts and the
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
