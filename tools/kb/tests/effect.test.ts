import { describe, expect, test, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { openKb, openKbEffect, runWithKb, KbCtx } from "../src/context.ts";
import {
  DomainError,
  domainError,
  isDomainError,
} from "../src/foundation/errors.ts";
import {
  isActionSchema,
  isStandardSchemaV1,
  parseActionInput,
  schemaToJsonSchema,
} from "../src/foundation/schema-seam.ts";
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

  test("runWithKb provides KbCtx and Bun FileSystem", async () => {
    root = await tempRoot();
    const ctx = await openKb(root);
    const result = await runWithKb(
      ctx,
      Effect.gen(function* () {
        const live = yield* KbCtx;
        const fs = yield* FileSystem;
        const exists = yield* fs.exists(join(live.root, ".kb", "nodes.jsonl"));
        return { root: live.root, exists };
      }),
    );
    expect(result.root).toBe(root);
    expect(result.exists).toBe(true);
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
