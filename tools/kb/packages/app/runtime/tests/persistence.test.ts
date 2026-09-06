import { describe, expect, test, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKbEffect, runWithKb } from "../src/layers.ts";
import { openKb, persist, reload } from "../src/session.ts";
import { KbStore, kbStoreLayer, type EffectStore } from "@kb/contracts";
import { persistEffect, reloadEffect } from "@kb/operations";
import { bunFileSystemLayer, JsonlStore } from "@kb/store-jsonl";
import {
  canonicalJson,
  DomainError,
  isDomainError,
  present,
  SYSTEM_IDS,
  type KbNode,
  type StoreTx,
} from "@kb/model";

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

function load(store: EffectStore): Promise<KbNode[]> {
  return Effect.runPromise(store.loadEffect);
}

function commit(store: EffectStore, tx: StoreTx): Promise<void> {
  return Effect.runPromise(store.commitEffect(tx));
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
      store.loadEffect.pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(nodes).toEqual([]);
  });

  test("commitEffect + loadEffect round-trip via FileSystem Layer", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    const nodes = [sampleNode("n.b", "b"), sampleNode("n.a", "a")];
    await Effect.runPromise(
      store.commitEffect({ upserts: nodes, deletes: [] }).pipe(Effect.provide(bunFileSystemLayer)),
    );
    const loaded = await Effect.runPromise(
      store.loadEffect.pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(loaded.map((n) => n.id)).toEqual(["n.a", "n.b"]);
  });

  test("malformed JSONL maps to DomainError invalid_input", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await mkdir(join(root, ".kb"), { recursive: true });
    await writeFile(store.path, "{not-json\n", "utf8");

    const caught = await Effect.runPromise(
      store.loadEffect.pipe(
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
    await writeFile(store.path, `${JSON.stringify({ id: 1, text: "bad" })}\n`, "utf8");

    const caught = await Effect.runPromise(
      store.loadEffect.pipe(
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
      store.loadEffect.pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(loaded).toHaveLength(1);
    expect(present(loaded[0], "expected loaded[0]").id).toBe("n.extra");
    expect((loaded[0] as KbNode & { legacyNote?: string }).legacyNote).toBe("keep-me");

    await Effect.runPromise(
      store.commitEffect({ upserts: loaded, deletes: [] }).pipe(Effect.provide(bunFileSystemLayer)),
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
      store.loadEffect.pipe(
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
      store.commitEffect({ upserts: [sampleNode("n.new")], deletes: [] }).pipe(
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
    await commit(store, { upserts: [sampleNode("n.1")], deletes: [] });
    await commit(store, { upserts: [sampleNode("n.2")], deletes: [] });
    const bak = await readFile(store.backupPath, "utf8");
    expect(bak).toContain("n.1");
  });

  test("commit keeps prior file as .bak (backup semantics)", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await commit(store, { upserts: [sampleNode("n.1", "one")], deletes: [] });
    const first = await readFile(store.path, "utf8");

    await commit(store, { upserts: [sampleNode("n.2", "two")], deletes: [] });
    const second = await readFile(store.path, "utf8");
    const bak = await readFile(store.backupPath, "utf8");

    expect(second).not.toBe(first);
    expect(bak).toBe(first);
    expect(second).toContain("n.2");
    expect(bak).toContain("n.1");
  });

  test("concurrent commits serialize via write lock (no lost update)", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await commit(store, { upserts: [sampleNode("n.seed", "seed")], deletes: [] });

    const writers = Array.from({ length: 8 }, (_, i) =>
      commit(store, {
        upserts: [sampleNode(`n.w${i}`, `w${i}`)],
        deletes: [],
      }),
    );
    await Promise.all(writers);

    const loaded = await load(store);
    const ids = new Set(loaded.map((n) => n.id));
    expect(ids.has("n.seed")).toBe(true);
    for (let i = 0; i < 8; i++) {
      expect(ids.has(`n.w${i}`)).toBe(true);
    }
  });

  test("stale lock file is stolen so commits proceed", async () => {
    root = await tempRoot();
    const store = new JsonlStore(root);
    await mkdir(join(root, ".kb"), { recursive: true });
    const { lockPathFor } = await import("@kb/store-jsonl");
    await writeFile(lockPathFor(store.path), "999999999\n", "utf8");

    await commit(store, { upserts: [sampleNode("n.after-stale", "ok")], deletes: [] });
    const loaded = await load(store);
    expect(loaded.some((n) => n.id === "n.after-stale")).toBe(true);
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
      // A store with no fingerprint of its own: nothing to compare against, so
      // reload always goes to the port rather than short-circuiting.
      path: join(root, ".kb", "mock.jsonl"),
      watchPaths: [],
      loadEffect: Effect.sync(() => {
        loads += 1;
        return injected;
      }),
      fingerprint: Effect.succeed(null),
      commitEffect: () => Effect.void,
    };

    await Effect.runPromise(
      reloadEffect(ctx).pipe(
        Effect.provide(Layer.mergeAll(kbStoreLayer(mock), bunFileSystemLayer)),
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
      path: ctx.store.path,
      watchPaths: [],
      loadEffect: Effect.succeed([]),
      fingerprint: Effect.succeed(null),
      commitEffect: (tx) =>
        Effect.sync(() => {
          commits.push(tx);
        }),
    };

    const node = sampleNode("n.via-layer", "layer");
    await Effect.runPromise(
      persistEffect(ctx, { upserts: [node], deletes: [] }).pipe(
        Effect.provide(Layer.mergeAll(kbStoreLayer(mock), bunFileSystemLayer)),
      ),
    );
    expect(commits).toHaveLength(1);
    expect(present(commits[0], "expected commits[0]").upserts.map((n) => n.id)).toEqual([
      "n.via-layer",
    ]);
    expect(ctx.nodes.some((n) => n.id === "n.via-layer")).toBe(true);
  });

  test("openKbEffect + Promise reload/persist preserve public API", async () => {
    root = await tempRoot();
    const ctx = await Effect.runPromise(
      openKbEffect(root).pipe(Effect.provide(bunFileSystemLayer)),
    );
    await persist(ctx, { upserts: [sampleNode("n.p", "p")], deletes: [] });
    const external = new JsonlStore(root);
    await commit(external, { upserts: [sampleNode("n.external", "e")], deletes: [] });
    await reload(ctx);
    expect(ctx.nodes.some((n) => n.id === "n.p")).toBe(true);
    expect(ctx.nodes.some((n) => n.id === "n.external")).toBe(true);
  });

  test("runWithKb KbStore.yield matches context store", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const same = await runWithKb(
      ctx,
      Effect.gen(function* () {
        const store = yield* KbStore;
        return store === ctx.store;
      }),
    );
    expect(same).toBe(true);
  });
});

describe("virtual query preservation", () => {
  let root: string;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("deleting a real persisted sys.query.* does not resurrect it as virtual", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const realQuery = sampleNode("sys.query.persisted", "persisted-query");
    await persist(ctx, { upserts: [realQuery], deletes: [] });
    expect(ctx.index.getNode("sys.query.persisted")).toBeDefined();

    // persist path: a stored node is not virtual, so deleting it is final.
    await persist(ctx, { upserts: [], deletes: ["sys.query.persisted"] });
    expect(ctx.nodes.some((n) => n.id === "sys.query.persisted")).toBe(false);
    expect(ctx.index.getNode("sys.query.persisted")).toBeUndefined();

    // reload path: node was real in the pre-reload snapshot, gone on disk.
    await persist(ctx, { upserts: [realQuery], deletes: [] });
    const store = new JsonlStore(root);
    const onDisk = await load(store);
    await commit(store, {
      upserts: onDisk.filter((n) => n.id !== "sys.query.persisted"),
      deletes: ["sys.query.persisted"],
    });
    expect(ctx.nodes.some((n) => n.id === "sys.query.persisted")).toBe(true);
    expect(ctx.index.getNode("sys.query.persisted")).toBeDefined();
    await reload(ctx);
    expect(ctx.nodes.some((n) => n.id === "sys.query.persisted")).toBe(false);
    expect(ctx.index.getNode("sys.query.persisted")).toBeUndefined();
  });

  test("synthetic/virtual sys.query.* not in prior snapshot is preserved", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const virtualRoot = sampleNode(SYSTEM_IDS.queriesRoot, "queries");
    virtualRoot.children = ["sys.query.virtual"];
    const virtualQuery = sampleNode("sys.query.virtual", "virtual-query");
    ctx.index.withVirtual([virtualRoot, virtualQuery]);

    await persist(ctx, {
      upserts: [sampleNode("n.other", "other")],
      deletes: [],
    });
    expect(ctx.index.getNode("sys.query.virtual")).toBeDefined();
    expect(ctx.index.getNode(SYSTEM_IDS.queriesRoot)).toBeDefined();
    expect(ctx.nodes.some((n) => n.id === "sys.query.virtual")).toBe(false);

    await reload(ctx);
    expect(ctx.index.getNode("sys.query.virtual")).toBeDefined();
    expect(ctx.index.getNode(SYSTEM_IDS.queriesRoot)).toBeDefined();
  });
});
