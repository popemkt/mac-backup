import { Effect, Schema, Semaphore } from "effect";
import { FileSystem } from "effect/FileSystem";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { domainError, type DomainError } from "../errors.ts";
import type { KbNode } from "../model.ts";
import { bunFileSystemLayer } from "../platform.ts";
import { canonicalJson } from "./canonical.ts";
import { KbNodeSchema, nodeParseOptions } from "./node-schema.ts";
import type { EffectStore, Store, StoreTx } from "./store.ts";

/** In-process gate per absolute nodes.jsonl path (multi-instance / multi-fiber). */
const commitGates = new Map<string, Semaphore.Semaphore>();

function commitGateFor(path: string): Semaphore.Semaphore {
  const key = resolve(path);
  let gate = commitGates.get(key);
  if (!gate) {
    gate = Semaphore.makeUnsafe(1);
    commitGates.set(key, gate);
  }
  return gate;
}

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

function isAlreadyExists(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { _tag?: unknown; reason?: unknown; message?: unknown };
  if (e._tag === "AlreadyExists") return true;
  if (e.reason === "AlreadyExists") return true;
  return typeof e.message === "string" && /AlreadyExists/i.test(e.message);
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

/**
 * Exclusive create of `lockPath` (wx). Retries while another live holder owns
 * it; clears stale locks left by crashed writers. Interruptible via sleep.
 */
function acquireCommitLock(
  fs: FileSystem,
  lockPath: string,
): Effect.Effect<void, DomainError> {
  const maxAttempts = 500;
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const acquired = yield* fs
        .writeFileString(lockPath, `${process.pid}\n`, { flag: "wx" })
        .pipe(
          Effect.as(true as const),
          Effect.catch((err) =>
            isAlreadyExists(err)
              ? Effect.succeed(false as const)
              : Effect.fail(mapFsError(err)),
          ),
        );
      if (acquired) return;

      const body = yield* fs
        .readFileString(lockPath)
        .pipe(Effect.catch(() => Effect.succeed("")));
      const holder = Number.parseInt(body.trim(), 10);
      if (!pidAlive(holder)) {
        yield* fs
          .remove(lockPath, { force: true })
          .pipe(Effect.catch(() => Effect.void));
        continue;
      }
      yield* Effect.sleep("10 millis");
    }
    return yield* Effect.fail(
      domainError("conflict", `commit lock timeout for ${lockPath}`, {
        lockPath,
      }),
    );
  });
}

/**
 * JSONL backend: `<root>/.kb/nodes.jsonl`
 * One canonical-JSON node per line, sorted by id.
 * Commits are atomic (tmp + rename) and keep `nodes.jsonl.bak` of the prior file.
 *
 * Concurrent commits (multi-fiber, multi-JsonlStore instance, or multi-process
 * surfaces on the same path) are serialized: an in-process per-path semaphore
 * plus an exclusive `nodes.jsonl.lock` file. Upserts and the merged snapshot
 * are schema-validated before any durable write; invalid input fails with
 * `invalid_input` and leaves the live file untouched.
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
    const gate = commitGateFor(path);

    return gate.withPermits(1)(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem;

          // Directory must exist before the exclusive lock create (wx).
          yield* fs
            .makeDirectory(dirname(path), { recursive: true })
            .pipe(Effect.mapError(mapFsError));

          yield* Effect.acquireRelease(
            acquireCommitLock(fs, lockPath).pipe(Effect.as(lockPath)),
            (p) => fs.remove(p, { force: true }).pipe(Effect.ignore),
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

          yield* fs
            .writeFileString(tmp, body)
            .pipe(Effect.mapError(mapFsError));

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
      ),
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
