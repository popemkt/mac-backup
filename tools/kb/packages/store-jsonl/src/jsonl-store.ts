import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import { domainError, type DomainError } from "@kb/model";
import type { KbNode } from "@kb/model";
import { bunFileSystemLayer } from "./platform.ts";
import { canonicalJson } from "@kb/model";
import { durableReplaceFile } from "./durable-replace.ts";
import { KbNodeSchema, nodeParseOptions } from "@kb/model";
import type { EffectStore, Store } from "@kb/contracts";
import type { StoreTx } from "@kb/model";
import {
  acquireNodesWriteLockEffect,
  ensureDomainError,
  releaseNodesWriteLock,
} from "./write-lock.ts";

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
    // Preserve unknown own keys (prior JSON.parse cast kept them). Strip would
    // silently drop data on the next commit rewrite.
    const node = yield* Schema.decodeUnknownEffect(
      KbNodeSchema,
      nodeParseOptions,
    )(raw).pipe(
      Effect.mapError((err) =>
        domainError(
          "invalid_input",
          `invalid node at ${path}:${lineNo}: ${err.message}`,
          { path, lineNo, issue: err.issue },
        ),
      ),
    );
    return node as KbNode;
  });
}

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
 * Effect-native I/O: {@link loadEffect}/{@link commitEffect} (yield* FileSystem).
 * Promise {@link load}/{@link commit} are public adapters for tests/context.
 */
export class JsonlStore implements Store, EffectStore {
  readonly path: string;
  readonly backupPath: string;

  constructor(root: string) {
    this.path = join(root, ".kb", "nodes.jsonl");
    this.backupPath = `${this.path}.bak`;
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
    const loadEffect = this.loadEffect.bind(this);
    return Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          acquireNodesWriteLockEffect(path),
          (lockPath) => Effect.sync(() => releaseNodesWriteLock(lockPath)),
        );

        const existing = yield* loadEffect();
        const byId = new Map(existing.map((n) => [n.id, n]));
        for (const id of tx.deletes) byId.delete(id);
        for (const node of tx.upserts) byId.set(node.id, node);

        const sorted = [...byId.values()].sort((a, b) =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        );
        const body =
          sorted.length === 0
            ? ""
            : sorted.map((n) => canonicalJson(n)).join("\n") + "\n";

        yield* Effect.try({
          try: () => durableReplaceFile(path, backupPath, body),
          catch: (err) => ensureDomainError(err),
        });
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
