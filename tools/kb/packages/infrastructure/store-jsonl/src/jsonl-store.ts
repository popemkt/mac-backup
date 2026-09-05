import { Effect, Option, Predicate, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import {
  domainError,
  ensureDomainError,
  type DomainError,
  canonicalJson,
  decodeStoredNode,
  type KbNode,
  type StoreTx,
} from "@kb/model";
import { bunFileSystemLayer } from "./platform.ts";
import { durableReplaceFile } from "./durable-replace.ts";
import type { EffectStore, StoreFingerprint } from "@kb/contracts";
import { acquireNodesWriteLockEffect, releaseNodesWriteLock } from "./write-lock.ts";

function mapFsError(err: unknown): DomainError {
  const message =
    Predicate.hasProperty(err, "message") && typeof err.message === "string"
      ? err.message
      : String(err);
  return domainError("internal", message);
}

/** Decode a complete JSONL document without performing filesystem I/O. */
const decodeNodes = Effect.fn("decodeNodes")(function* (body: string, path: string) {
  let lineNo = 0;

  return yield* Effect.try({
    try: () => {
      // Accumulate only after every line validates — fail the whole load on the
      // first bad line (no partial KbNode[] for callers; no file mutation here).
      const nodes: KbNode[] = [];
      const lines = body.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined || line.trim().length === 0) continue;
        lineNo = i + 1;
        const raw = JSON.parse(line) as unknown;
        nodes.push(decodeStoredNode(raw));
      }
      return nodes;
    },
    catch: (err) => {
      if (Schema.isSchemaError(err)) {
        return domainError("invalid_input", `invalid node at ${path}:${lineNo}: ${err.message}`, {
          path,
          lineNo,
          issue: err.issue,
        });
      }
      return domainError(
        "invalid_input",
        `malformed JSONL at ${path}:${lineNo}: ${err instanceof Error ? err.message : String(err)}`,
        { path, lineNo },
      );
    },
  });
});

/**
 * JSONL backend: `<root>/.kb/nodes.jsonl`
 * One canonical-JSON node per line, sorted by id.
 *
 * Commits (r4 Stage-0 hardening, format unchanged):
 * - exclusive `.lock` covering load → mutate → replace
 * - durable replace: write+fsync tmp, rotate `.bak`, rename, fsync dir
 *
 * Load is all-or-nothing: any malformed/invalid line fails the Effect with a
 * line-numbered DomainError and returns no nodes — the file is never rewritten
 * by load (compatible with the pre-Schema loader, which threw mid-parse).
 *
 * Effect-native I/O: {@link JsonlStore.loadEffect}/{@link JsonlStore.commitEffect}.
 * The Bun FileSystem is provided here, not asked of callers.
 */
export class JsonlStore implements EffectStore {
  readonly path: string;
  readonly backupPath: string;
  /** One file is the whole store; `.bak` and `.lock` are its own bookkeeping. */
  readonly watchPaths: readonly string[];
  readonly loadEffect: Effect.Effect<KbNode[], DomainError>;
  readonly fingerprint: Effect.Effect<StoreFingerprint | null>;

  constructor(root: string) {
    this.path = join(root, ".kb", "nodes.jsonl");
    this.backupPath = `${this.path}.bak`;
    this.watchPaths = [this.path];
    this.loadEffect = loadNodes(this.path);
    this.fingerprint = fingerprintOf(this.path);
  }

  commitEffect(tx: StoreTx): Effect.Effect<void, DomainError> {
    const path = this.path;
    const backupPath = this.backupPath;
    const loadEffect = this.loadEffect;
    return Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(acquireNodesWriteLockEffect(path), (lockPath) =>
          Effect.sync(() => releaseNodesWriteLock(lockPath)),
        );

        const existing = yield* loadEffect;
        const byId = new Map(existing.map((n) => [n.id, n]));
        for (const id of tx.deletes) byId.delete(id);
        for (const node of tx.upserts) byId.set(node.id, node);

        const sorted = [...byId.values()].toSorted((a, b) =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        );
        const body =
          sorted.length === 0 ? "" : sorted.map((n) => canonicalJson(n)).join("\n") + "\n";

        yield* Effect.try({
          try: () => durableReplaceFile(path, backupPath, body),
          catch: (err) => ensureDomainError(err),
        });
      }),
    ).pipe(Effect.provide(bunFileSystemLayer));
  }
}

/**
 * Size plus mtime, the cheap answer to "did this file change?". A write that
 * lands inside the same mtime tick *and* keeps the byte count identical is
 * invisible to it, which is the price of not hashing the file — recorded as
 * GAP [[01M1PK5NYA7ZG3XC0H0YRYRVZE]]. A file that is not there yet has no
 * fingerprint, and null compares equal to nothing.
 */
function fingerprintOf(path: string): Effect.Effect<StoreFingerprint | null> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    return yield* fs.stat(path).pipe(
      Effect.map(
        (info): StoreFingerprint | null =>
          `${String(info.size)}:${String(Option.isSome(info.mtime) ? info.mtime.value.getTime() : 0)}`,
      ),
      Effect.orElseSucceed(() => null),
    );
  }).pipe(Effect.provide(bunFileSystemLayer));
}

/** The store's own platform boundary: JSONL on the Bun filesystem. */
function loadNodes(path: string): Effect.Effect<KbNode[], DomainError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const exists = yield* fs.exists(path).pipe(Effect.mapError(mapFsError));
    if (!exists) return [];

    const body = yield* fs.readFileString(path).pipe(Effect.mapError(mapFsError));
    if (body.trim().length === 0) return [];

    return yield* decodeNodes(body, path);
  }).pipe(Effect.provide(bunFileSystemLayer));
}
