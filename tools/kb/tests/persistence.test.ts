import { describe, expect, test, afterEach } from "bun:test";
import { Effect, Fiber } from "effect";
import { FileSystem } from "effect/FileSystem";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  bunFileSystemLayer,
  kbStoreLayer,
  openKb,
  openKbEffect,
  persist,
  persistEffect,
  reload,
  reloadEffect,
  runWithKb,
  KbStore,
} from "../src/context.ts";
import {
  DomainError,
  isDomainError,
} from "../src/foundation/errors.ts";
import type { KbNode } from "../src/foundation/model.ts";
import { SYSTEM_IDS } from "../src/foundation/model.ts";
import { buildQueryDb } from "../src/foundation/query/index.ts";
import {
  JsonlStore,
  COMMIT_LOCK_STALE_MS,
  COMMIT_LOCK_TIMEOUT_MS,
  claimStaleLock,
  ownsCommitLock,
  canonicalJson,
  type EffectStore,
  type StoreTx,
} from "../src/foundation/storage/index.ts";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kb-persist-"));
}

function lockArtifacts(files: string[]): string[] {
  return files.filter(
    (f) =>
      f.endsWith(".tmp") ||
      f === "nodes.jsonl.lock" ||
      f.startsWith("nodes.jsonl.lock."),
  );
}

async function plantStaleLock(lockPath: string, token = "planted-stale"): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(
    lockPath,
    JSON.stringify({
      v: 1,
      pid: 2147483647,
      token,
      createdAt: Date.now() - COMMIT_LOCK_STALE_MS - 1_000,
    }),
  );
}

async function plantLiveLock(
  lockPath: string,
  token: string,
  pid = process.pid,
  createdAt = Date.now(),
): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(
    lockPath,
    JSON.stringify({ v: 1, pid, token, createdAt }),
  );
}

/**
 * Pre-warm N children behind a go-file barrier so arrivals contend for real,
 * not just boot skew. Safety gate is lost===0; explicit conflict rejections
 * are logged separately (liveness, not silent upsert loss).
 */
async function spawnCrossProcessCommits(
  root: string,
  ids: string[],
): Promise<{ codes: number[]; logs: string[]; conflicts: number }> {
  const storePath = join(
    import.meta.dir,
    "../src/foundation/storage/jsonl-store.ts",
  );
  const goPath = join(root, ".kb", ".stress-go");
  await mkdir(join(root, ".kb"), { recursive: true });

  const procs = ids.map((id) => {
    const code = `
      import { existsSync } from "node:fs";
      import { JsonlStore } from ${JSON.stringify(storePath)};
      const go = ${JSON.stringify(goPath)};
      while (!existsSync(go)) {
        await Bun.sleep(5);
      }
      const store = new JsonlStore(${JSON.stringify(root)});
      const at = "2026-01-01T00:00:00.000Z";
      try {
        await store.commit({
          upserts: [{ id: ${JSON.stringify(id)}, text: ${JSON.stringify(id)}, props: {}, children: [], createdAt: at, updatedAt: at }],
          deletes: [],
        });
      } catch (e) {
        const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
        const code = e && typeof e === "object" && "code" in e ? String(e.code) : "";
        console.error("COMMIT_FAIL", ${JSON.stringify(id)}, code, msg);
        process.exit(code === "conflict" ? 2 : 1);
      }
    `;
    return Bun.spawn(["bun", "-e", code], {
      stdout: "pipe",
      stderr: "pipe",
    });
  });

  // Give children time to boot past import before releasing the barrier.
  await Bun.sleep(250);
  await writeFile(goPath, "go\n");

  const results = await Promise.all(
    procs.map(async (p) => {
      const code = await p.exited;
      const err = await new Response(p.stderr).text();
      return { code, err: err.trim() };
    }),
  );
  return {
    codes: results.map((r) => r.code),
    logs: results.map((r) => r.err).filter(Boolean),
    conflicts: results.filter((r) => r.code === 2).length,
  };
}

function sampleNode(id: string, text = id): KbNode {
  const at = "2026-01-01T00:00:00.000Z";
  return {
    id,
    text,
    props: {},
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}

describe("JsonlStore Effect persistence", () => {
  let root: string;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("loadEffect returns [] when file missing", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    const nodes = await Effect.runPromise(
      store.loadEffect().pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(nodes).toEqual([]);
  });

  test("commitEffect + loadEffect round-trip via FileSystem Layer", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    const nodes = [sampleNode("n.b", "b"), sampleNode("n.a", "a")];
    await Effect.runPromise(
      store
        .commitEffect({ upserts: nodes, deletes: [] })
        .pipe(Effect.provide(bunFileSystemLayer)),
    );
    const loaded = await Effect.runPromise(
      store.loadEffect().pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(loaded.map((n) => n.id)).toEqual(["n.a", "n.b"]);
  });

  test("malformed JSONL maps to DomainError invalid_input", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await mkdir(join(root, ".kb"), { recursive: true });
    await writeFile(store.path, "{not-json\n", "utf8");

    const caught = await Effect.runPromise(
      store.loadEffect().pipe(
        Effect.provide(bunFileSystemLayer),
        Effect.catch((e) => Effect.succeed(e)),
      ),
    );
    expect(isDomainError(caught)).toBe(true);
    expect(caught).toBeInstanceOf(DomainError);
    if (isDomainError(caught)) {
      expect(caught.code).toBe("invalid_input");
      expect(caught.message).toMatch(/malformed JSONL/);
    }
  });

  test("schema-invalid node maps to DomainError invalid_input", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await mkdir(join(root, ".kb"), { recursive: true });
    await writeFile(
      store.path,
      `${JSON.stringify({ id: 1, text: "bad" })}\n`,
      "utf8",
    );

    const caught = await Effect.runPromise(
      store.loadEffect().pipe(
        Effect.provide(bunFileSystemLayer),
        Effect.catch((e) => Effect.succeed(e)),
      ),
    );
    expect(isDomainError(caught)).toBe(true);
    if (isDomainError(caught)) {
      expect(caught.code).toBe("invalid_input");
      expect(caught.message).toMatch(/invalid node/);
    }
  });

  test("load/commit round-trip preserves unknown own JSON properties", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await mkdir(join(root, ".kb"), { recursive: true });
    const at = "2026-01-01T00:00:00.000Z";
    const withExtra = {
      id: "n.extra",
      text: "has-extra",
      props: {},
      children: [] as string[],
      createdAt: at,
      updatedAt: at,
      legacyNote: "keep-me",
    };
    await writeFile(store.path, `${JSON.stringify(withExtra)}\n`, "utf8");

    const loaded = await Effect.runPromise(
      store.loadEffect().pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("n.extra");
    expect((loaded[0] as KbNode & { legacyNote?: string }).legacyNote).toBe(
      "keep-me",
    );

    await Effect.runPromise(
      store
        .commitEffect({ upserts: loaded, deletes: [] })
        .pipe(Effect.provide(bunFileSystemLayer)),
    );
    const body = await readFile(store.path, "utf8");
    const rewritten = JSON.parse(body.trim()) as Record<string, unknown>;
    expect(rewritten.legacyNote).toBe("keep-me");
    expect(rewritten.id).toBe("n.extra");
  });

  test("validation failure is all-or-nothing: no partial load, no rewrite", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await mkdir(join(root, ".kb"), { recursive: true });
    const good = sampleNode("n.good", "good");
    const original = `${canonicalJson(good)}\n{not-json\n`;
    await writeFile(store.path, original, "utf8");

    const caught = await Effect.runPromise(
      store.loadEffect().pipe(
        Effect.provide(bunFileSystemLayer),
        Effect.catch((e) => Effect.succeed(e)),
      ),
    );
    expect(isDomainError(caught)).toBe(true);
    if (isDomainError(caught)) {
      expect(caught.code).toBe("invalid_input");
      expect(caught.message).toMatch(/:2:/);
      expect(caught.details).toMatchObject({ lineNo: 2 });
    }
    // Not a partial success value — caller only sees the error.
    expect(Array.isArray(caught)).toBe(false);

    const afterLoad = await readFile(store.path, "utf8");
    expect(afterLoad).toBe(original);

    const commitCaught = await Effect.runPromise(
      store
        .commitEffect({ upserts: [sampleNode("n.new")], deletes: [] })
        .pipe(
          Effect.provide(bunFileSystemLayer),
          Effect.catch((e) => Effect.succeed(e)),
        ),
    );
    expect(isDomainError(commitCaught)).toBe(true);
    const afterCommit = await readFile(store.path, "utf8");
    expect(afterCommit).toBe(original);
    expect(afterCommit).not.toContain("n.new");
  });

  test("openKb fails closed on malformed jsonl without rewriting", async () => {
    root = await tempRoot();
    await mkdir(join(root, ".kb"), { recursive: true });
    const path = join(root, ".kb", "nodes.jsonl");
    const original = `${canonicalJson(sampleNode("n.a"))}\nbad-line\n`;
    await writeFile(path, original, "utf8");

    let threw = false;
    try {
      await openKb(root);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  test("commit backupPath matches gitignored .bak artifact name", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    expect(store.backupPath.endsWith("nodes.jsonl.bak")).toBe(true);
    await store.commit({ upserts: [sampleNode("n.1")], deletes: [] });
    await store.commit({ upserts: [sampleNode("n.2")], deletes: [] });
    const bak = await readFile(store.backupPath, "utf8");
    expect(bak).toContain("n.1");
  });

  test("commit keeps prior file as .bak (backup semantics)", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await store.commit({ upserts: [sampleNode("n.1", "one")], deletes: [] });
    const first = await readFile(store.path, "utf8");

    await store.commit({ upserts: [sampleNode("n.2", "two")], deletes: [] });
    const second = await readFile(store.path, "utf8");
    const bak = await readFile(store.backupPath, "utf8");

    expect(second).not.toBe(first);
    expect(bak).toBe(first);
    expect(second).toContain("n.2");
    expect(bak).toContain("n.1");
  });

  test("failed rename leaves prior file intact (atomicity)", async () => {
    root = await tempRoot();
    const live = new JsonlStore(root);
    await live.commit({ upserts: [sampleNode("n.keep", "keep")], deletes: [] });
    const before = await readFile(live.path, "utf8");

    // Real Bun FS for read/write/copy; only rename fails — prior file must remain.
    const real = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* FileSystem;
      }).pipe(Effect.provide(bunFileSystemLayer)),
    );
    const atomicFs = {
      ...real,
      rename: () =>
        Effect.fail({
          message: "simulated rename failure",
        } as never),
    } as FileSystem;

    const caught = await Effect.runPromise(
      live
        .commitEffect({ upserts: [sampleNode("n.new", "new")], deletes: [] })
        .pipe(
          Effect.provideService(FileSystem, atomicFs),
          Effect.catch((e) => Effect.succeed(e)),
        ),
    );
    expect(isDomainError(caught)).toBe(true);
    if (isDomainError(caught)) {
      expect(caught.message).toMatch(/simulated rename failure/);
    }
    const after = await readFile(live.path, "utf8");
    expect(after).toBe(before);
    expect(after).toContain("n.keep");
    expect(after).not.toContain("n.new");
    const orphans = (await readdir(join(root, ".kb"))).filter((f) =>
      f.endsWith(".tmp"),
    );
    expect(orphans).toEqual([]);
  });

  test("concurrent commits on one store retain every upsert", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    const N = 10;
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        store.commit({ upserts: [sampleNode(`n.${i}`)], deletes: [] }),
      ),
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const loaded = await store.load();
    const ids = loaded.map((n) => n.id).sort();
    expect(ids).toEqual(
      Array.from({ length: N }, (_, i) => `n.${i}`).sort(),
    );
  });

  test("concurrent commits across JsonlStore instances retain every upsert", async () => {
    root = await tempRoot();
    const a = new JsonlStore(root);
    const b = new JsonlStore(root);
    const results = await Promise.allSettled([
      a.commit({ upserts: [sampleNode("n.a")], deletes: [] }),
      b.commit({ upserts: [sampleNode("n.b")], deletes: [] }),
      a.commit({ upserts: [sampleNode("n.c")], deletes: [] }),
      b.commit({ upserts: [sampleNode("n.d")], deletes: [] }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const loaded = await a.load();
    expect(loaded.map((n) => n.id).sort()).toEqual(["n.a", "n.b", "n.c", "n.d"]);
  });

  test("concurrent commitEffect fibers retain every upsert", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    const N = 8;
    await Effect.runPromise(
      Effect.all(
        Array.from({ length: N }, (_, i) =>
          store.commitEffect({
            upserts: [sampleNode(`n.e${i}`)],
            deletes: [],
          }),
        ),
        { concurrency: "unbounded" },
      ).pipe(Effect.provide(bunFileSystemLayer)),
    );
    const loaded = await store.load();
    expect(loaded.map((n) => n.id).sort()).toEqual(
      Array.from({ length: N }, (_, i) => `n.e${i}`).sort(),
    );
  });

  test("Window B: content-verified claim cannot steal live lock after ABA", async () => {
    root = await tempRoot();
    const lockPath = join(root, ".kb", "nodes.jsonl.lock");
    await plantStaleLock(lockPath, "planted-stale");
    const staleBody = await readFile(lockPath, "utf8");

    const fs = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* FileSystem;
      }).pipe(Effect.provide(bunFileSystemLayer)),
    );

    // W1: content-verified reclaim of dead-pid body.
    const w1Claimed = await Effect.runPromise(
      claimStaleLock(fs, lockPath, staleBody, "w1-token").pipe(
        Effect.provide(bunFileSystemLayer),
      ),
    );
    expect(w1Claimed).toBe(true);

    // W1 installs a live lock (same inode number possible on reuse).
    await plantLiveLock(lockPath, "w1-live");

    // W2 still holds the OLD decision-time body — must not remove w1-live.
    const w2Claimed = await Effect.runPromise(
      claimStaleLock(fs, lockPath, staleBody, "w2-token").pipe(
        Effect.provide(bunFileSystemLayer),
      ),
    );
    expect(w2Claimed).toBe(false);
    const w1Owns = await Effect.runPromise(
      ownsCommitLock(fs, lockPath, "w1-live").pipe(
        Effect.provide(bunFileSystemLayer),
      ),
    );
    expect(w1Owns).toBe(true);
  });

  test("public acquire reclaim: concurrent commits after planted stale lose zero", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await plantStaleLock(store.lockPath, "planted-for-acquire");
    const N = 6;
    const ids = Array.from({ length: N }, (_, i) => `n.acq${i}`);
    await Effect.runPromise(
      Effect.all(
        ids.map((id) =>
          store.commitEffect({ upserts: [sampleNode(id)], deletes: [] }),
        ),
        { concurrency: "unbounded" },
      ).pipe(Effect.provide(bunFileSystemLayer)),
    );
    const loaded = await store.load();
    expect(loaded.map((n) => n.id).sort()).toEqual([...ids].sort());
  });

  test("ownsCommitLock rejects foreign token", async () => {
    root = await tempRoot();
    const lockPath = join(root, ".kb", "nodes.jsonl.lock");
    await plantLiveLock(lockPath, "attacker");
    const fs = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* FileSystem;
      }).pipe(Effect.provide(bunFileSystemLayer)),
    );
    const stillOurs = await Effect.runPromise(
      ownsCommitLock(fs, lockPath, "victim").pipe(
        Effect.provide(bunFileSystemLayer),
      ),
    );
    expect(stillOurs).toBe(false);
  });

  test("cross-process stress: 40×N=8 zero lost upserts (conflicts logged)", async () => {
    const RUNS = 40;
    const N = 8;
    let lost = 0;
    let conflicts = 0;
    let hardFails = 0;
    for (let run = 0; run < RUNS; run++) {
      const runRoot = await tempRoot();
      try {
        const ids = Array.from({ length: N }, (_, i) => `n.r${run}.p${i}`);
        const result = await spawnCrossProcessCommits(runRoot, ids);
        conflicts += result.conflicts;
        hardFails += result.codes.filter((c) => c !== 0 && c !== 2).length;
        const store = new JsonlStore(runRoot);
        const loaded = await store.load();
        const got = new Set(loaded.map((n) => n.id));
        // Safety: only count ids that exited 0 but are missing (true silent loss).
        let runLost = 0;
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i]!;
          if (result.codes[i] === 0 && !got.has(id)) {
            lost += 1;
            runLost += 1;
          }
        }
        if (runLost > 0) {
          throw new Error(
            `stress no-stale run ${run}: lost=${runLost} conflicts=${result.conflicts} codes=${result.codes.join(",")} ids=${ids.join(",")} got=${[...got].sort().join(",")} logs=${JSON.stringify(result.logs)}`,
          );
        }
      } finally {
        await rm(runRoot, { recursive: true, force: true });
      }
    }
    expect({ lost, hardFails, runs: RUNS, N }).toEqual({
      lost: 0,
      hardFails: 0,
      runs: RUNS,
      N,
    });
    if (conflicts > 0) {
      console.log(`stress no-stale: logged ${conflicts} explicit conflict exits (liveness)`);
    }
  }, 180_000);

  test("cross-process stress with planted stale locks: 30×N=8 zero loss", async () => {
    const RUNS = 30;
    const N = 8;
    let lost = 0;
    let conflicts = 0;
    let hardFails = 0;
    for (let run = 0; run < RUNS; run++) {
      const runRoot = await tempRoot();
      try {
        await plantStaleLock(
          join(runRoot, ".kb", "nodes.jsonl.lock"),
          `stale-${run}`,
        );
        const ids = Array.from({ length: N }, (_, i) => `n.s${run}.p${i}`);
        const result = await spawnCrossProcessCommits(runRoot, ids);
        conflicts += result.conflicts;
        hardFails += result.codes.filter((c) => c !== 0 && c !== 2).length;
        const store = new JsonlStore(runRoot);
        const loaded = await store.load();
        const got = new Set(loaded.map((n) => n.id));
        let runLost = 0;
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i]!;
          if (result.codes[i] === 0 && !got.has(id)) {
            lost += 1;
            runLost += 1;
          }
        }
        if (runLost > 0) {
          throw new Error(
            `stress planted-stale run ${run}: lost=${runLost} conflicts=${result.conflicts} codes=${result.codes.join(",")} ids=${ids.join(",")} got=${[...got].sort().join(",")} logs=${JSON.stringify(result.logs)}`,
          );
        }
      } finally {
        await rm(runRoot, { recursive: true, force: true });
      }
    }
    expect({ lost, hardFails, runs: RUNS, N }).toEqual({
      lost: 0,
      hardFails: 0,
      runs: RUNS,
      N,
    });
    if (conflicts > 0) {
      console.log(`stress planted-stale: logged ${conflicts} explicit conflict exits (liveness)`);
    }
  }, 180_000);

  test("crash/stale lock with dead pid is reclaimed; commit succeeds", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await plantStaleLock(store.lockPath, "dead-owner");
    await store.commit({ upserts: [sampleNode("n.after-stale")], deletes: [] });
    const loaded = await store.load();
    expect(loaded.map((n) => n.id)).toEqual(["n.after-stale"]);
    expect(lockArtifacts(await readdir(join(root, ".kb")))).toEqual([]);
  });

  test("live pid past STALE_MS is NOT stolen (dead-pid-only stale)", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await plantLiveLock(
      store.lockPath,
      "reused-pid-old",
      process.pid,
      Date.now() - COMMIT_LOCK_STALE_MS - 1_000,
    );
    const before = await readFile(store.lockPath, "utf8");

    const fiber = await Effect.runPromise(
      Effect.forkDetach(
        store
          .commitEffect({ upserts: [sampleNode("n.should-block")], deletes: [] })
          .pipe(Effect.provide(bunFileSystemLayer)),
      ).pipe(Effect.provide(bunFileSystemLayer)),
    );
    await Effect.runPromise(Effect.sleep("300 millis"));
    // Product path must not reclaim a live holder regardless of createdAt age.
    expect(await readFile(store.lockPath, "utf8")).toBe(before);
    await Effect.runPromise(Fiber.interrupt(fiber));
    await rm(store.lockPath, { force: true });
  });

  test("live recent lock is not stolen; waiter times out conflict", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await plantLiveLock(store.lockPath, "live-hold");

    // maxAttempts=4 × COMMIT_LOCK_TIMEOUT_MS with retryable acquire timeout.
    const budget = 4 * COMMIT_LOCK_TIMEOUT_MS;
    const started = Date.now();
    const caught = await Effect.runPromise(
      store
        .commitEffect({ upserts: [sampleNode("n.blocked")], deletes: [] })
        .pipe(
          Effect.provide(bunFileSystemLayer),
          Effect.catch((e) => Effect.succeed(e)),
        ),
    );
    const elapsed = Date.now() - started;
    expect(isDomainError(caught)).toBe(true);
    if (isDomainError(caught)) {
      expect(caught.code).toBe("conflict");
    }
    expect(elapsed).toBeGreaterThanOrEqual(budget - 2_000);
    expect(elapsed).toBeLessThan(budget + 8_000);
    await rm(store.lockPath, { force: true });
  }, 90_000);

  test("empty/unparseable lock body is not deleted as stale", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await mkdir(dirname(store.lockPath), { recursive: true });
    await writeFile(store.lockPath, "");

    const fiber = await Effect.runPromise(
      Effect.forkDetach(
        store
          .commitEffect({ upserts: [sampleNode("n.x")], deletes: [] })
          .pipe(Effect.provide(bunFileSystemLayer)),
      ).pipe(Effect.provide(bunFileSystemLayer)),
    );
    await Effect.runPromise(Effect.sleep("80 millis"));
    // Still empty — waiter must not have removed it as "stale".
    expect(await readFile(store.lockPath, "utf8")).toBe("");
    await Effect.runPromise(Fiber.interrupt(fiber));
    await Effect.runPromise(Effect.sleep("50 millis"));
    await rm(store.lockPath, { force: true });
  });

  test("lock-wait acquisition is interruptible well under timeout", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await plantLiveLock(store.lockPath, "hold-interrupt");

    const fiber = await Effect.runPromise(
      Effect.forkDetach(
        store
          .commitEffect({ upserts: [sampleNode("n.int")], deletes: [] })
          .pipe(Effect.provide(bunFileSystemLayer)),
      ).pipe(Effect.provide(bunFileSystemLayer)),
    );
    await Effect.runPromise(Effect.sleep("30 millis"));
    const t0 = Date.now();
    await Effect.runPromise(Fiber.interrupt(fiber));
    const interruptMs = Date.now() - t0;
    expect(interruptMs).toBeLessThan(500);
    await rm(store.lockPath, { force: true });
  });

  test("invalid upsert is rejected and leaves prior file untouched", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await store.commit({ upserts: [sampleNode("n.keep")], deletes: [] });
    const before = await readFile(store.path, "utf8");

    const bad = {
      ...sampleNode("n.bad"),
      props: { "sys.f.type": [{ t: "weird", v: 1 }] },
    } as unknown as KbNode;

    const caught = await Effect.runPromise(
      store.commitEffect({ upserts: [bad], deletes: [] }).pipe(
        Effect.provide(bunFileSystemLayer),
        Effect.catch((e) => Effect.succeed(e)),
      ),
    );
    expect(isDomainError(caught)).toBe(true);
    if (isDomainError(caught)) {
      expect(caught.code).toBe("invalid_input");
      expect(caught.message).toMatch(/upsert/);
    }
    expect(await readFile(store.path, "utf8")).toBe(before);
    const reopened = await store.load();
    expect(reopened.map((n) => n.id)).toEqual(["n.keep"]);
  });

  test("uncorrelated prop upsert cannot brick later loads", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    const bad = {
      ...sampleNode("n.bad"),
      props: { "sys.f.type": [{ t: "num", v: "not-a-number" }] },
    } as unknown as KbNode;
    await expect(
      store.commit({ upserts: [bad], deletes: [] }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(store.load()).resolves.toEqual([]);
  });

  test("failed writeFileString leaves no tmp orphan and prior intact", async () => {
    root = await tempRoot();
    const live = new JsonlStore(root);
    await live.commit({ upserts: [sampleNode("n.keep")], deletes: [] });
    const before = await readFile(live.path, "utf8");
    const real = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* FileSystem;
      }).pipe(Effect.provide(bunFileSystemLayer)),
    );
    const failingFs = {
      ...real,
      writeFileString: ((p, data, opts) => {
        if (p.endsWith(".tmp")) {
          return Effect.fail({ message: "simulated write failure" } as never);
        }
        return real.writeFileString(p, data, opts);
      }) as FileSystem["writeFileString"],
    } as FileSystem;

    const caught = await Effect.runPromise(
      live
        .commitEffect({ upserts: [sampleNode("n.new")], deletes: [] })
        .pipe(
          Effect.provideService(FileSystem, failingFs),
          Effect.catch((e) => Effect.succeed(e)),
        ),
    );
    expect(isDomainError(caught)).toBe(true);
    expect(await readFile(live.path, "utf8")).toBe(before);
    const orphans = (await readdir(join(root, ".kb"))).filter((f) =>
      f.endsWith(".tmp"),
    );
    expect(orphans).toEqual([]);
  });

  test("failed copyFile leaves no tmp orphan and prior intact", async () => {
    root = await tempRoot();
    const live = new JsonlStore(root);
    await live.commit({ upserts: [sampleNode("n.keep")], deletes: [] });
    const before = await readFile(live.path, "utf8");
    const real = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* FileSystem;
      }).pipe(Effect.provide(bunFileSystemLayer)),
    );
    const failingFs = {
      ...real,
      copyFile: () =>
        Effect.fail({ message: "simulated copy failure" } as never),
    } as FileSystem;

    const caught = await Effect.runPromise(
      live
        .commitEffect({ upserts: [sampleNode("n.new")], deletes: [] })
        .pipe(
          Effect.provideService(FileSystem, failingFs),
          Effect.catch((e) => Effect.succeed(e)),
        ),
    );
    expect(isDomainError(caught)).toBe(true);
    expect(await readFile(live.path, "utf8")).toBe(before);
    const orphans = (await readdir(join(root, ".kb"))).filter((f) =>
      f.endsWith(".tmp"),
    );
    expect(orphans).toEqual([]);
  });

  test("interrupt during commit cleans tmp and lock orphans", async () => {
    root = await tempRoot();
    const live = new JsonlStore(root);
    await live.commit({ upserts: [sampleNode("n.keep")], deletes: [] });
    const before = await readFile(live.path, "utf8");
    const real = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* FileSystem;
      }).pipe(Effect.provide(bunFileSystemLayer)),
    );
    const slowFs = {
      ...real,
      writeFileString: ((p, data, opts) => {
        if (p.endsWith(".tmp")) {
          return Effect.gen(function* () {
            yield* Effect.sleep("2 seconds");
            return yield* real.writeFileString(p, data, opts);
          });
        }
        return real.writeFileString(p, data, opts);
      }) as FileSystem["writeFileString"],
    } as FileSystem;

    const fiber = await Effect.runPromise(
      Effect.forkDetach(
        live
          .commitEffect({ upserts: [sampleNode("n.new")], deletes: [] })
          .pipe(Effect.provideService(FileSystem, slowFs)),
      ).pipe(Effect.provide(bunFileSystemLayer)),
    );
    await Effect.runPromise(Effect.sleep("50 millis"));
    await Effect.runPromise(Fiber.interrupt(fiber));
    await Effect.runPromise(Effect.sleep("50 millis"));

    expect(await readFile(live.path, "utf8")).toBe(before);
    const files = await readdir(join(root, ".kb"));
    expect(lockArtifacts(files)).toEqual([]);
  });
});

describe("reload / persist via KbStore Layer substitution", () => {
  let root: string;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("reloadEffect reads through substituted KbStore", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const injected: KbNode[] = [sampleNode("n.injected", "from-mock")];
    let loads = 0;
    const mock: EffectStore = {
      path: join(root, ".kb", "nodes.jsonl"),
      loadEffect: () =>
        Effect.sync(() => {
          loads += 1;
          return injected;
        }),
      commitEffect: () => Effect.void,
    };

    await Effect.runPromise(
      reloadEffect(ctx).pipe(
        Effect.provide(kbStoreLayer(mock)),
        Effect.provide(bunFileSystemLayer),
      ),
    );
    expect(loads).toBe(1);
    expect(ctx.nodes.some((n) => n.id === "n.injected")).toBe(true);
  });

  test("persistEffect commits through substituted KbStore", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const commits: StoreTx[] = [];
    const mock: EffectStore = {
      path: ctx.effectStore.path,
      loadEffect: () => Effect.succeed([]),
      commitEffect: (tx) =>
        Effect.sync(() => {
          commits.push(tx);
        }),
    };

    const node = sampleNode("n.via-layer", "layer");
    await Effect.runPromise(
      persistEffect(ctx, { upserts: [node], deletes: [] }).pipe(
        Effect.provide(kbStoreLayer(mock)),
        Effect.provide(bunFileSystemLayer),
      ),
    );
    expect(commits).toHaveLength(1);
    expect(commits[0]!.upserts.map((n) => n.id)).toEqual(["n.via-layer"]);
    expect(ctx.nodes.some((n) => n.id === "n.via-layer")).toBe(true);
  });

  test("openKbEffect + Promise reload/persist preserve public API", async () => {
    root = await tempRoot();
    const ctx = await Effect.runPromise(
      openKbEffect(root).pipe(Effect.provide(bunFileSystemLayer)),
    );
    await persist(ctx, { upserts: [sampleNode("n.p", "p")], deletes: [] });
    ctx.nodes = [];
    await reload(ctx);
    expect(ctx.nodes.some((n) => n.id === "n.p")).toBe(true);
  });

  test("runWithKb KbStore.yield matches effectStore instance", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const same = await runWithKb(
      ctx,
      Effect.gen(function* () {
        const store = yield* KbStore;
        return store === ctx.effectStore;
      }),
    );
    expect(same).toBe(true);
  });
});

describe("rebuildQdb virtual query preservation", () => {
  let root: string;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("deleting a real persisted sys.query.* does not resurrect it as virtual", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const realQuery = sampleNode("sys.query.persisted", "persisted-query");
    await persist(ctx, { upserts: [realQuery], deletes: [] });
    expect(ctx.qdb.nodes.has("sys.query.persisted")).toBe(true);

    // persist path: capture prior real ids before applying deletes.
    await persist(ctx, { upserts: [], deletes: ["sys.query.persisted"] });
    expect(ctx.nodes.some((n) => n.id === "sys.query.persisted")).toBe(false);
    expect(ctx.qdb.nodes.has("sys.query.persisted")).toBe(false);

    // reload path: node was real in the pre-reload snapshot, gone on disk.
    await persist(ctx, { upserts: [realQuery], deletes: [] });
    const store = new JsonlStore(root);
    const onDisk = await store.load();
    await store.commit({
      upserts: onDisk.filter((n) => n.id !== "sys.query.persisted"),
      deletes: ["sys.query.persisted"],
    });
    expect(ctx.nodes.some((n) => n.id === "sys.query.persisted")).toBe(true);
    expect(ctx.qdb.nodes.has("sys.query.persisted")).toBe(true);
    await reload(ctx);
    expect(ctx.nodes.some((n) => n.id === "sys.query.persisted")).toBe(false);
    expect(ctx.qdb.nodes.has("sys.query.persisted")).toBe(false);
  });

  test("synthetic/virtual sys.query.* not in prior snapshot is preserved", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const virtualRoot = sampleNode(SYSTEM_IDS.queriesRoot, "queries");
    virtualRoot.children = ["sys.query.virtual"];
    const virtualQuery = sampleNode("sys.query.virtual", "virtual-query");
    ctx.qdb = buildQueryDb([...ctx.nodes, virtualRoot, virtualQuery]);

    await persist(ctx, {
      upserts: [sampleNode("n.other", "other")],
      deletes: [],
    });
    expect(ctx.qdb.nodes.has("sys.query.virtual")).toBe(true);
    expect(ctx.qdb.nodes.has(SYSTEM_IDS.queriesRoot)).toBe(true);
    expect(ctx.nodes.some((n) => n.id === "sys.query.virtual")).toBe(false);

    await reload(ctx);
    expect(ctx.qdb.nodes.has("sys.query.virtual")).toBe(true);
    expect(ctx.qdb.nodes.has(SYSTEM_IDS.queriesRoot)).toBe(true);
  });
});
