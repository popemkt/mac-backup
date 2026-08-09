import { describe, expect, test, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import {
  openKb,
  openKbEffect,
  persist,
  reload,
  runWithKb,
  KbCtx,
  KbStore,
} from "../src/context.ts";
import {
  DomainError,
  domainError,
  isDomainError,
} from "../src/foundation/errors.ts";
import {
  ActionSchemaError,
  isActionSchema,
  isStandardSchemaV1,
  parseActionInput,
  schemaToJsonSchema,
} from "../src/foundation/schema-seam.ts";
import { DocsError } from "../src/operations/docs/index.ts";
import { mapRenderErr } from "../src/render/index.ts";
import { invoke, invokeEffect } from "../src/registry.ts";
import { z } from "zod";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kb-effect-"));
}

describe("Effect services + layers", () => {
  let root: string;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("openKbEffect seeds system nodes", async () => {
    root = await tempRoot();
    const ctx = await Effect.runPromise(openKbEffect(root));
    expect(ctx.nodes.some((n) => n.id === "sys.tag")).toBe(true);
    expect(ctx.store).toBeTruthy();
  });

  test("runWithKb provides KbCtx, KbStore, and Bun FileSystem", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const result = await runWithKb(
      ctx,
      Effect.gen(function* () {
        const live = yield* KbCtx;
        const store = yield* KbStore;
        const fs = yield* FileSystem;
        const exists = yield* fs.exists(join(live.root, ".kb", "nodes.jsonl"));
        return {
          root: live.root,
          exists,
          sameStore: store === live.store,
        };
      }),
    );
    expect(result.root).toBe(root);
    expect(result.exists).toBe(true);
    expect(result.sameStore).toBe(true);
  });

  test("reload/persist consume provided KbStore layer", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const before = ctx.nodes.length;
    await persist(ctx, {
      upserts: [
        {
          id: "n.effect-store",
          text: "via KbStore",
          props: {},
          children: [],
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
      deletes: [],
    });
    expect(ctx.nodes.some((n) => n.id === "n.effect-store")).toBe(true);
    expect(ctx.nodes.length).toBe(before + 1);

    // Drop in-memory state, then reload through the KbStore port.
    ctx.nodes = [];
    await reload(ctx);
    expect(ctx.nodes.some((n) => n.id === "n.effect-store")).toBe(true);
  });

  test("DomainError maps to typed invoke receipts", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const err = domainError("not_found", "missing node", { id: "n.x" });
    expect(isDomainError(err)).toBe(true);
    expect(err).toBeInstanceOf(DomainError);

    const receipt = await Effect.runPromise(
      invokeEffect(ctx, { id: "node.get", input: { id: "n.missing" } }).pipe(
        Effect.catch((e) =>
          Effect.succeed({
            status: "failed" as const,
            id: "node.get",
            code: isDomainError(e) ? e.code : "internal",
            message: e instanceof Error ? e.message : String(e),
          }),
        ),
        Effect.provideService(KbCtx, ctx),
      ),
    );
    // Prefer the public Promise boundary for exact receipt shape.
    const publicReceipt = await invoke(ctx, {
      id: "node.get",
      input: { id: "n.missing" },
    });
    expect(publicReceipt.status).toBe("failed");
    if (publicReceipt.status === "failed") {
      expect(publicReceipt.code).toBe("not_found");
      expect(publicReceipt.message).toContain("n.missing");
    }
    expect(receipt.status).toBe("failed");
  });
});

describe("render DomainError path", () => {
  test("mapRenderErr keeps DomainError via runtime instanceof", () => {
    const domain = domainError("internal", "render boom", { where: "test" });
    expect(mapRenderErr(domain)).toBe(domain);
    expect(mapRenderErr(domain)).toBeInstanceOf(DomainError);

    const docs = new DocsError("not_found", "missing view", { viewName: "x" });
    expect(mapRenderErr(docs)).toBe(docs);

    const mapped = mapRenderErr(new Error("unexpected"));
    expect(mapped).toBeInstanceOf(DomainError);
    expect(mapped.code).toBe("internal");
    expect(mapped.message).toBe("unexpected");
  });

  test("render.view unknown view stays DocsError not ReferenceError", async () => {
    const root = await tempRoot();
    try {
      const ctx = await openKb(root);
      await mkdir(join(root, ".kb", "views"), { recursive: true });
      // Ensure views dir exists but the named view does not.
      await writeFile(join(root, ".kb", "views", ".keep"), "");
      const receipt = await invoke(ctx, {
        id: "render.view",
        input: { name: "no-such-view", format: "html" },
      });
      expect(receipt.status).toBe("failed");
      if (receipt.status === "failed") {
        expect(receipt.code).toBe("not_found");
        expect(receipt.message).toContain("no-such-view");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("ActionSchemaError override", () => {
  test("name override is ActionSchemaError", () => {
    const err = new ActionSchemaError("bad", [{ message: "bad" }]);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ActionSchemaError");
  });
});

describe("Standard Schema v1 seam", () => {
  test("zod schemas satisfy Standard Schema v1 and parseActionInput", async () => {
    const schema = z.object({ name: z.string() });
    expect(isStandardSchemaV1(schema)).toBe(true);
    expect(isActionSchema(schema)).toBe(true);
    const value = await parseActionInput(schema, { name: "kb" });
    expect(value).toEqual({ name: "kb" });
    expect(schemaToJsonSchema(schema)).toMatchObject({ type: "object" });
  });

  test("pure Standard Schema v1 (no zod) is accepted", async () => {
    const schema = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: (input: unknown) => {
          if (
            typeof input === "object" &&
            input !== null &&
            typeof (input as { n?: unknown }).n === "number"
          ) {
            return { value: input };
          }
          return { issues: [{ message: "expected { n: number }" }] };
        },
      },
    };
    expect(isActionSchema(schema)).toBe(true);
    expect(await parseActionInput(schema, { n: 1 })).toEqual({ n: 1 });
    await expect(parseActionInput(schema, { n: "x" })).rejects.toThrow(
      /expected/,
    );
    // Non-zod vendors emit a permissive JSON Schema for manifests.
    expect(schemaToJsonSchema(schema)).toEqual({ type: "object" });
  });

  test("parse-only (legacy) schemas still work", async () => {
    const schema = {
      parse: (input: unknown) => {
        if (typeof input !== "string") throw new Error("need string");
        return input.toUpperCase();
      },
    };
    expect(isActionSchema(schema)).toBe(true);
    expect(await parseActionInput(schema, "hi")).toBe("HI");
  });
});
