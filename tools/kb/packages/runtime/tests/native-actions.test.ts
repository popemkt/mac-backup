import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Exit, Fiber } from "effect";
import { kbRuntimeLayer, openKbEffect } from "../src/layers.ts";
import { openKb } from "../src/session.ts";
import { KbCtx, KbStore } from "@kb/contracts";
import { bunFileSystemLayer } from "@kb/store-jsonl";
import {
  invoke,
  invokeReceiptEffect,
  isEffectNativeAction,
  registryFor,
  resetRegistryCache,
} from "../src/registry.ts";
import type { ActionEffectHandler, EffectStore } from "@kb/contracts";
import type { StoreTx } from "@kb/model";

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
    const registry = await registryFor(null);
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
    const sample: ActionEffectHandler | undefined = owned[0]!.effect;
    expect(sample).toBeDefined();
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
    mode: "read",
    inputSchema: z.object({ name: z.string().default("world") }),
    outputSchema: z.object({ message: z.string() }),
    handler: async (_ctx, input) => ({ message: \`hi \${input.name}\` }),
  },
  {
    id: "boom",
    title: "Boom",
    description: "promise typed failure",
    mode: "read",
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

    const registry = await registryFor(root);
    const legacy = registry.byId.get("ext.legacy.ok");
    expect(legacy?.effect).toBeUndefined();
    expect(legacy?.handler).toBeTypeOf("function");
    expect(isEffectNativeAction(legacy!)).toBe(false);
  });

  test("Layer substitution: native write uses provided KbStore", async () => {
    const root = await makeRoot();
    const ctx = await Effect.runPromise(
      openKbEffect(root).pipe(Effect.provide(bunFileSystemLayer)),
    );

    const commits: StoreTx[] = [];
    const fakeStore: EffectStore = {
      path: join(root, ".kb", "nodes.jsonl"),
      loadEffect: () => Effect.succeed(ctx.nodes),
      commitEffect: (tx) =>
        Effect.sync(() => {
          commits.push(tx);
          const byId = new Map(ctx.nodes.map((n) => [n.id, n]));
          for (const id of tx.deletes) byId.delete(id);
          for (const n of tx.upserts) byId.set(n.id, n);
          ctx.nodes = [...byId.values()];
        }),
    };

    const receipt = await Effect.runPromise(
      invokeReceiptEffect(ctx, {
        id: "node.add",
        input: { text: "via-substituted-store", id: "n.layer-sub" },
      }).pipe(
        Effect.provideService(KbCtx, ctx),
        Effect.provideService(KbStore, fakeStore),
        Effect.provide(bunFileSystemLayer),
      ),
    );
    expect(receipt.status).toBe("succeeded");
    expect(commits.length).toBe(1);
    expect(commits[0]!.upserts.some((n) => n.id === "n.layer-sub")).toBe(true);

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
    mode: "apply",
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
});
