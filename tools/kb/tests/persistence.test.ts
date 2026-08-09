import { describe, expect, test, afterEach } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import {
  JsonlStore,
  type EffectStore,
  type StoreTx,
} from "../src/foundation/storage/index.ts";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kb-persist-"));
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
