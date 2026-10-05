import { afterEach, describe, expect, test } from "bun:test";
import { present } from "@kb/model";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Exit, Fiber, Layer, Stream } from "effect";
import { kbRuntimeLayer, openKbEffect } from "../src/layers.ts";
import { openKb } from "../src/session.ts";
import {
  ActionCatalog,
  ExtensionCatalog,
  KbCtx,
  KbStore,
  ViewCatalog,
  templateRegistryLayer,
} from "@kb/contracts";
import { viewCatalogOf } from "@kb/views";
import { bunFileSystemLayer } from "../src/platform.ts";
import { remoteScreensLayer } from "../src/screens.ts";
import {
  assetsLayer,
  codeTrustLayer,
  legacyDocsViewsLayer,
  savedQueriesLayer,
} from "@kb/workspace-fs";
import { KbIndexService } from "@kb/query";
import { invoke } from "../src/invoke.ts";
import {
  invokeReceiptEffect,
  isEffectNativeAction,
  registryFor,
  resetRegistryCache,
} from "../src/registry.ts";
import type { ActionEffectHandler, EffectStore } from "@kb/contracts";
import type { StoreTx } from "@kb/model";
import { MemoryTxTail } from "@kb/tx-log";
import { graphWritesLayer } from "@kb/operations";

/** Under tests/ so fixture extensions resolve zod via tools/kb/node_modules. */
async function tempRoot(): Promise<string> {
  return mkdtemp(join(import.meta.dir, "kb-native-"));
}

let roots: string[] = [];

afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
  resetRegistryCache();
});

async function makeRoot(): Promise<string> {
  const root = await tempRoot();
  roots.push(root);
  return root;
}

describe("Effect-native action registry", () => {
  test("core + bundled actions register effect and no Promise handler", async () => {
    const registry = await Effect.runPromise(
      registryFor(null).pipe(Effect.provide(bunFileSystemLayer)),
    );
    const owned = registry.actions.filter(
      (a) => a.source === "core" || a.source === "ext:docs" || a.source === "ext:canvas",
    );
    expect(owned.length).toBeGreaterThan(0);
    for (const action of owned) {
      expect(isEffectNativeAction(action)).toBe(true);
      expect(action.effect).toBeTypeOf("function");
      expect(action.handler).toBeUndefined();
    }

    // Compile-time seam: ActionEffectHandler is the Effect form.
    const sample: ActionEffectHandler | undefined = present(owned[0], "expected owned[0]").effect;
    expect(sample).toBeDefined();
  });

  test("output its own schema rejects is an internal failure, not a success", async () => {
    const root = await makeRoot();
    const dir = join(root, ".kb", "extensions");
    await mkdir(dir, { recursive: true });
    // Both handler kinds, so neither path can publish an unchecked result.
    await writeFile(
      join(dir, "liar.ts"),
      `import { z } from "zod";
import { Effect } from "effect";
const actions = [
  {
    id: "native",
    title: "Native liar",
    description: "effect handler whose result breaks its contract",
    mode: { kind: "read" },
    inputSchema: z.object({}),
    outputSchema: z.object({ count: z.number() }),
    effect: () => Effect.succeed({ count: "not a number" }),
  },
  {
    id: "promise",
    title: "Promise liar",
    description: "promise handler whose result breaks its contract",
    mode: { kind: "read" },
    inputSchema: z.object({}),
    outputSchema: z.object({ count: z.number() }),
    handler: async () => ({ count: "not a number" }),
  },
];
export default actions;
`,
      "utf8",
    );

    const ctx = await openKb(root);
    for (const id of ["ext.liar.native", "ext.liar.promise"]) {
      const receipt = await invoke(ctx, { id, input: {} });
      expect(receipt.status).toBe("failed");
      if (receipt.status === "failed") {
        expect(receipt.code).toBe("internal");
        expect(receipt.message).toContain(id);
      }
    }
  });

  test("a receipt carries what the output schema produced, not the raw result", async () => {
    const root = await makeRoot();
    const dir = join(root, ".kb", "extensions");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "extra.ts"),
      `import { z } from "zod";
import { Effect } from "effect";
const actions = [
  {
    id: "surplus",
    title: "Surplus",
    description: "returns more than it declares",
    mode: { kind: "read" },
    inputSchema: z.object({}),
    outputSchema: z.object({ kept: z.string() }),
    effect: () => Effect.succeed({ kept: "yes", undeclared: "no" }),
  },
];
export default actions;
`,
      "utf8",
    );

    const ctx = await openKb(root);
    const receipt = await invoke(ctx, { id: "ext.extra.surplus", input: {} });
    expect(receipt.status).toBe("succeeded");
    if (receipt.status === "succeeded") {
      expect(receipt.output).toEqual({ kept: "yes" });
    }
  });

  test("legacy Promise extension still succeeds and fails canonically", async () => {
    const root = await makeRoot();
    const dir = join(root, ".kb", "extensions");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "legacy.ts"),
      `import { z } from "zod";
const actions = [
  {
    id: "ok",
    title: "Ok",
    description: "promise success",
    mode: { kind: "read" },
    inputSchema: z.object({ name: z.string().default("world") }),
    outputSchema: z.object({ message: z.string() }),
    handler: async (_ctx, input) => ({ message: \`hi \${input.name}\` }),
  },
  {
    id: "boom",
    title: "Boom",
    description: "promise typed failure",
    mode: { kind: "read" },
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    handler: async () => {
      const err = new Error("legacy boom");
      (err as { code?: string }).code = "conflict";
      throw err;
    },
  },
];
export default actions;
`,
      "utf8",
    );

    const ctx = await openKb(root);
    const ok = await invoke(ctx, {
      id: "ext.legacy.ok",
      input: { name: "ext" },
    });
    expect(ok.status).toBe("succeeded");
    if (ok.status === "succeeded") {
      expect(ok.output).toEqual({ message: "hi ext" });
    }

    const boom = await invoke(ctx, { id: "ext.legacy.boom", input: {} });
    expect(boom.status).toBe("failed");
    if (boom.status === "failed") {
      expect(boom.code).toBe("conflict");
      expect(boom.message).toBe("legacy boom");
    }

    const registry = await Effect.runPromise(
      registryFor(root).pipe(Effect.provide(bunFileSystemLayer)),
    );
    const legacy = registry.byId.get("ext.legacy.ok");
    expect(legacy?.effect).toBeUndefined();
    expect(legacy?.handler).toBeTypeOf("function");
    expect(isEffectNativeAction(present(legacy, "expected legacy"))).toBe(false);
  });

  test("Layer substitution: native write uses provided KbStore", async () => {
    const root = await makeRoot();
    const ctx = await Effect.runPromise(
      openKbEffect(root).pipe(Effect.provide(bunFileSystemLayer)),
    );

    const commits: StoreTx[] = [];
    const fakeStore: EffectStore = {
      path: join(root, ".kb", "nodes.jsonl"),
      changes: Stream.never,
      loadEffect: Effect.succeed(ctx.nodes),
      fingerprint: Effect.succeed(null),
      txTail: new MemoryTxTail(),
      commitEffect: (tx) =>
        Effect.sync(() => {
          commits.push(tx);
          return { base: null, fingerprint: null, tx };
        }),
    };

    const receipt = await Effect.runPromise(
      invokeReceiptEffect(ctx, {
        id: "node.add",
        input: { text: "via-substituted-store", id: "n.layer-sub" },
      }).pipe(
        Effect.provideService(KbCtx, ctx),
        Effect.provideService(KbStore, fakeStore),
        Effect.provideService(KbIndexService, ctx.index),
        Effect.provide(
          Layer.mergeAll(
            bunFileSystemLayer,
            templateRegistryLayer(new Map()),
            Layer.succeed(ActionCatalog, []),
            Layer.succeed(ViewCatalog, viewCatalogOf([])),
            Layer.succeed(ExtensionCatalog, []),
            savedQueriesLayer(root).pipe(Layer.provide(bunFileSystemLayer)),
            legacyDocsViewsLayer(root).pipe(Layer.provide(bunFileSystemLayer)),
            assetsLayer(root).pipe(Layer.provide(bunFileSystemLayer)),
            codeTrustLayer(root).pipe(Layer.provide(bunFileSystemLayer)),
            remoteScreensLayer(root).pipe(Layer.provide(bunFileSystemLayer)),
            graphWritesLayer.pipe(
              Layer.provide(
                Layer.merge(Layer.succeed(KbCtx, ctx), Layer.succeed(KbStore, fakeStore)),
              ),
            ),
          ),
        ),
      ),
    );
    expect(receipt.status).toBe("succeeded");
    expect(commits.length).toBe(1);
    expect(
      present(commits[0], "expected commits[0]").upserts.some((n) => n.id === "n.layer-sub"),
    ).toBe(true);

    // Reloading through the live store must not see the fake commit.
    const live = await openKb(root);
    expect(live.nodes.some((n) => n.id === "n.layer-sub")).toBe(false);
  });

  test("interrupting a long native handler runs finalizers and skips late writes", async () => {
    const root = await makeRoot();
    const dir = join(root, ".kb", "extensions");
    await mkdir(dir, { recursive: true });
    const marker = join(root, "finalized.marker");
    const late = join(root, "late.write");
    await writeFile(
      join(dir, "slow.ts"),
      `import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { z } from "zod";

const actions = [
  {
    id: "sleep",
    title: "Sleep",
    description: "long interruptible native handler",
    mode: { kind: "write" },
    inputSchema: z.object({
      marker: z.string(),
      late: z.string(),
    }),
    outputSchema: z.object({ ok: z.boolean() }),
    effect: (input) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        yield* Effect.addFinalizer(() =>
          fs.writeFileString(input.marker, "finalized").pipe(Effect.orDie),
        );
        yield* Effect.sleep("30 seconds");
        yield* fs.writeFileString(input.late, "should-not-land");
        return { ok: true };
      }),
  },
];
export default actions;
`,
      "utf8",
    );

    const ctx = await openKb(root);
    const fiber = Effect.runFork(
      invokeReceiptEffect(ctx, {
        id: "ext.slow.sleep",
        input: { marker, late },
      }).pipe(Effect.provide(kbRuntimeLayer(ctx))),
    );
    await Effect.runPromise(Effect.sleep("80 millis"));
    await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await Effect.runPromise(Fiber.await(fiber));
    expect(Exit.hasInterrupts(exit)).toBe(true);

    const markerBody = await Bun.file(marker).text();
    expect(markerBody).toBe("finalized");
    expect(await Bun.file(late).exists()).toBe(false);
  });

  test("an approval-required write runs only when its invocation is approved", async () => {
    const root = await makeRoot();
    const dir = join(root, ".kb", "extensions");
    await mkdir(dir, { recursive: true });
    const ran = join(root, "ran.marker");
    await writeFile(
      join(dir, "gate.ts"),
      `import { writeFile } from "node:fs/promises";
import { z } from "zod";
export default [
  {
    id: "stamp",
    title: "Stamp",
    description: "a write a person must approve",
    mode: { kind: "write", approval: "required" },
    inputSchema: z.object({ path: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    handler: async (_ctx, input) => {
      await writeFile(input.path, "ran");
      return { ok: true };
    },
  },
];
`,
      "utf8",
    );

    const ctx = await openKb(root);
    const refused = await invoke(ctx, { id: "ext.gate.stamp", input: { path: ran } });
    expect(refused).toMatchObject({ status: "failed", code: "approval_required" });
    expect(await Bun.file(ran).exists()).toBe(false);

    const approved = await invoke(ctx, {
      id: "ext.gate.stamp",
      input: { path: ran },
      approved: true,
    });
    expect(approved).toEqual({ status: "succeeded", id: "ext.gate.stamp", output: { ok: true } });
    expect(await Bun.file(ran).text()).toBe("ran");
  });
});
