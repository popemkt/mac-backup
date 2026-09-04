import { describe, expect, test, afterEach } from "bun:test";
import { Effect } from "effect";
import { bunFileSystemLayer } from "@kb/store-jsonl";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KB_SDK_DTS, KB_SDK_VERSION, writeSdkDts } from "@kb/ext-sdk";
import { discoverExtensions } from "@kb/operations";
import { openKb, invoke, registryFor, resetRegistryCache } from "@kb/runtime";
import { main } from "../src/cli.ts";

let roots: string[] = [];

async function tempRoot(prefix = "kb-sdk-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
  resetRegistryCache();
});

async function runCli(args: string[]): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    const code = await main(["bun", "kb", ...args]);
    return { code, out: chunks.join("") };
  } finally {
    process.stdout.write = original;
    process.exitCode = 0;
  }
}

describe("extension SDK surface", () => {
  test("ActionMode + FailureCode from SDK match runtime contracts", () => {
    // Belt-and-braces: ambient module must declare the same string unions.
    expect(KB_SDK_DTS).toContain('"read" | "apply"');
    expect(KB_SDK_DTS).toContain('"unknown_action"');
    expect(KB_SDK_DTS).toContain("export type ExtensionAction");
    expect(KB_SDK_DTS).toContain('declare module "kb-ext-sdk"');
  });
});

describe("kb ext sdk", () => {
  test("prints embedded dts; --write emits .kb/sdk.d.ts ignored by loader", async () => {
    const root = await tempRoot();
    const printed = await runCli(["--root", root, "ext", "sdk"]);
    expect(printed.code).toBe(0);
    expect(printed.out).toBe(KB_SDK_DTS);

    const written = await runCli(["--root", root, "ext", "sdk", "--write"]);
    expect(written.code).toBe(0);
    expect(written.out).toContain(`wrote .kb/sdk.d.ts (kb ${KB_SDK_VERSION})`);

    const onDisk = await readFile(join(root, ".kb", "sdk.d.ts"), "utf8");
    expect(onDisk).toBe(KB_SDK_DTS);

    const discovered = await Effect.runPromise(
      discoverExtensions(root).pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(discovered.extensions).toEqual([]);
    expect(discovered.failures).toEqual([]);
  });
});

describe("scratch external extension against shipped SDK", () => {
  test("tsc --noEmit succeeds with zero repo-relative imports; extension loads", async () => {
    const root = await tempRoot("kb-sdk-author-");
    await Effect.runPromise(writeSdkDts(root).pipe(Effect.provide(bunFileSystemLayer)));

    const extDir = join(root, ".kb", "extensions");
    await mkdir(extDir, { recursive: true });

    // Hand-rolled schema — no zod / no kb src imports (sanctioned runtime surface).
    const greet = `/// <reference path="../sdk.d.ts" />
import type { ExtensionAction } from "kb-ext-sdk";

const inputSchema = {
  parse(input: unknown) {
    const o = (input ?? {}) as { name?: unknown };
    return { name: typeof o.name === "string" ? o.name : "world" };
  },
};
const outputSchema = {
  parse(input: unknown) {
    return input;
  },
};

const actions: ExtensionAction[] = [
  {
    id: "greet",
    title: "Greet",
    description: "scratch SDK author fixture",
    mode: "read",
    inputSchema,
    outputSchema,
    handler: async (_ctx, input) => {
      const name = (input as { name: string }).name;
      return { message: \`hello \${name}\` };
    },
  },
];

export default actions;
`;
    await writeFile(join(extDir, "greet.ts"), greet, "utf8");

    // Bad mode must fail typecheck against the ambient SDK.
    const bad = greet.replace('mode: "read"', 'mode: "reed"');
    await writeFile(join(extDir, "bad-mode.ts"), bad, "utf8");

    const tsc = join(import.meta.dir, "../../../node_modules/.bin/tsc");
    const tscArgs = [
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--moduleResolution",
      "bundler",
      "--module",
      "ESNext",
      "--target",
      "ESNext",
    ];
    const goodCheck = spawnSync(tsc, [...tscArgs, join(extDir, "greet.ts")], { encoding: "utf8" });
    expect(goodCheck.status).toBe(0);

    const badCheck = spawnSync(tsc, [...tscArgs, join(extDir, "bad-mode.ts")], {
      encoding: "utf8",
    });
    expect(badCheck.status).not.toBe(0);
    expect(`${badCheck.stdout}\n${badCheck.stderr}`).toMatch(/reed/);

    // Only keep the good extension for runtime load.
    await rm(join(extDir, "bad-mode.ts"), { force: true });

    const ctx = await openKb(root);
    const receipt = await invoke(ctx, {
      id: "ext.greet.greet",
      input: { name: "sdk" },
    });
    expect(receipt.status).toBe("succeeded");
    if (receipt.status === "succeeded") {
      expect(receipt.output).toEqual({ message: "hello sdk" });
    }
    const registry = await Effect.runPromise(
      registryFor(root).pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(registry.failures).toEqual([]);
  });
});
