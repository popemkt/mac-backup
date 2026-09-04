/**
 * Exclusive write lock for JSONL commits.
 * Cover load → mutate → durable replace so concurrent CLI/MCP/UI writers
 * cannot silently clobber each other (r4 Stage-0).
 *
 * Lock file: `<nodes.jsonl>.lock` with the holder pid. Stale locks (dead pid)
 * are stolen after a short spin.
 *
 * Acquisition sleeps via Effect.sleep (never Bun.sleepSync) so concurrent
 * commits on the same event loop can make progress.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { Clock, Duration, Effect } from "effect";
import { domainError, type DomainError } from "@kb/model";

const LOCK_SUFFIX = ".lock";
const SPIN_MS = 25;
const MAX_WAIT_MS = 15_000;

export function lockPathFor(nodesPath: string): string {
  return `${nodesPath}${LOCK_SUFFIX}`;
}

function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM: process exists but we can't signal it — treat as alive.
    return code === "EPERM";
  }
}

function readLockPid(lockPath: string): number | null {
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    const pid = Number(raw);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function tryCreateLock(lockPath: string): boolean {
  try {
    const fd = openSync(lockPath, "wx");
    try {
      writeFileSync(fd, `${process.pid}\n`);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

function stealIfStale(lockPath: string): boolean {
  if (!existsSync(lockPath)) return false;
  const pid = readLockPid(lockPath);
  if (pid !== null && pidAlive(pid)) return false;
  try {
    unlinkSync(lockPath);
  } catch {
    return false;
  }
  return tryCreateLock(lockPath);
}

function ensureLockDir(lockPath: string): void {
  mkdirSync(dirname(lockPath), { recursive: true });
}

/** Effectful acquire — yields while spinning so other fibers can run. */
export const acquireNodesWriteLockEffect = Effect.fn("kb.acquireWriteLock")(function* (
  nodesPath: string,
): Effect.fn.Return<string, DomainError> {
  const lockPath = lockPathFor(nodesPath);
  yield* Effect.try({
    try: () => ensureLockDir(lockPath),
    catch: (err) =>
      domainError(
        "internal",
        `failed to create lock directory for ${lockPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { lockPath },
      ),
  });

  const started = yield* Clock.currentTimeMillis;
  for (;;) {
    const got = yield* Effect.try({
      try: () => tryCreateLock(lockPath) || stealIfStale(lockPath),
      catch: (err) =>
        domainError(
          "internal",
          `failed to acquire write lock ${lockPath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          { lockPath },
        ),
    });
    if (got) return lockPath;

    if ((yield* Clock.currentTimeMillis) - started > MAX_WAIT_MS) {
      const holder = readLockPid(lockPath);
      return yield* domainError(
        "conflict",
        `timed out waiting for write lock ${lockPath}` +
          (holder !== null ? ` (held by pid ${holder})` : ""),
        { lockPath, holder },
      );
    }
    yield* Effect.sleep(Duration.millis(SPIN_MS));
  }
});

/** Release a lock acquired by {@link acquireNodesWriteLockEffect} (best-effort). */
export function releaseNodesWriteLock(lockPath: string): void {
  try {
    const pid = readLockPid(lockPath);
    if (pid === process.pid || pid === null) unlinkSync(lockPath);
  } catch {
    // best-effort release
  }
}
