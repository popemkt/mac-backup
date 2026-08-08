import { describe, expect, test, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openKb } from "../src/context.ts";
import { invoke, registryFor, resetRegistryCache } from "../src/registry.ts";
import { main } from "../src/surface/cli.ts";

// Roots live under tests/ (not os tmpdir) so fixture extensions resolve
// "zod" through tools/kb/node_modules.
let roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "kb-ext-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
  resetRegistryCache();
});

const HELLO_EXT = `import { z } from "zod";

const actions = [
  {
    id: "greet",
    title: "Greet",
    description: "test extension action",
    mode: "read",
    inputSchema: z.object({ name: z.string().default("world") }),
    outputSchema: z.object({ message: z.string() }),
    handler: async (_ctx, input) => ({ message: \`hello \${input.name}\` }),
  },
];
export default actions;
`;

async function writeExtension(
  root: string,
  file: string,
  content: string,
): Promise<void> {
  const dir = join(root, ".kb", "extensions");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), content, "utf8");
}

async function runCli(args: string[]): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await main(["bun", "kb", ...args]);
    return { code, out: chunks.join("") };
  } finally {
    process.stdout.write = original;
    process.exitCode = 0;
  }
}

describe("extension loading", () => {
  test("repo extension registers under ext.<file>.<action> and invokes", async () => {
    const root = await tempRoot();
    await writeExtension(root, "hello.ts", HELLO_EXT);
    const ctx = await openKb(root);

    const receipt = await invoke(ctx, {
      id: "ext.hello.greet",
      input: { name: "kb" },
    });
    expect(receipt.status).toBe("succeeded");
    if (receipt.status === "succeeded") {
      expect(receipt.output).toEqual({ message: "hello kb" });
    }

    const registry = await registryFor(root);
    const ids = registry.manifestEntries.map((e) => e.id);
    expect(ids).toContain("ext.hello.greet");
    const hello = registry.extensions.find((e) => e.name === "hello");
    expect(hello?.actions.map((a) => a.def.id)).toEqual(["ext.hello.greet"]);
  });

  test("broken extension warns + skips; core and other extensions survive", async () => {
    const root = await tempRoot();
    await writeExtension(root, "broken.ts", 'throw new Error("boom");\n');
    await writeExtension(
      root,
      "shapeless.ts",
      "export default { not: 'an array' };\n",
    );
    await writeExtension(root, "hello.ts", HELLO_EXT);
    const ctx = await openKb(root);

    const registry = await registryFor(root);
    expect(registry.failures.map((f) => f.file).sort()).toEqual([
      "broken.ts",
      "shapeless.ts",
    ]);

    const greet = await invoke(ctx, { id: "ext.hello.greet", input: {} });
    expect(greet.status).toBe("succeeded");

    const add = await invoke(ctx, {
      id: "node.add",
      input: { text: "core still works" },
    });
    expect(add.status).toBe("succeeded");
  });

  test("unknown ids still fail with unknown_action", async () => {
    const root = await tempRoot();
    const ctx = await openKb(root);
    const receipt = await invoke(ctx, { id: "ext.nope.missing", input: {} });
    expect(receipt.status).toBe("failed");
    if (receipt.status === "failed") {
      expect(receipt.code).toBe("unknown_action");
    }
  });
});

describe("bundled docs extension", () => {
  test("legacy ids and ext.docs.* both invoke the bundled path", async () => {
    const root = await tempRoot();
    const ctx = await openKb(root);

    for (const id of ["docs.check", "ext.docs.check"]) {
      const receipt = await invoke(ctx, { id, input: {} });
      expect(receipt.status).toBe("succeeded");
      if (receipt.status === "succeeded") {
        expect(receipt.output).toEqual({ clean: true, views: [] });
      }
    }

    const materialize = await invoke(ctx, {
      id: "docs.materialize",
      input: {},
    });
    expect(materialize.status).toBe("succeeded");

    const registry = await registryFor(root);
    const alias = registry.manifestEntries.find(
      (e) => e.id === "docs.check",
    );
    expect(alias?.aliasOf).toBe("ext.docs.check");
  });
});

describe("kb ext list", () => {
  test("lists bundled + repo extensions, human and JSON", async () => {
    const root = await tempRoot();
    await writeExtension(root, "hello.ts", HELLO_EXT);
    await writeExtension(root, "broken.ts", 'throw new Error("boom");\n');

    const human = await runCli(["--root", root, "ext", "list"]);
    expect(human.code).toBe(0);
    expect(human.out).toContain("docs (bundled)");
    expect(human.out).toContain("ext.docs.materialize (alias: docs.materialize)");
    expect(human.out).toContain("ext.hello.greet");
    expect(human.out).toContain("! broken.ts");

    resetRegistryCache();
    const json = await runCli(["--root", root, "--json", "ext", "list"]);
    expect(json.code).toBe(0);
    const parsed = JSON.parse(json.out) as {
      status: string;
      output: {
        extensions: { name: string; actions: { id: string }[] }[];
        failures: { file: string }[];
      };
    };
    expect(parsed.status).toBe("succeeded");
    const names = parsed.output.extensions.map((e) => e.name).sort();
    expect(names).toEqual(["docs", "hello"]);
    expect(parsed.output.failures.map((f) => f.file)).toEqual(["broken.ts"]);
  });
});
