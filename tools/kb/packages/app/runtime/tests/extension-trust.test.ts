/**
 * A repository extension runs with the server's reach, so a root's
 * `.kb/extensions/*.ts` is imported only once a person has trusted it on
 * this machine (DESIGN.md → Core boundary & extensions → repository
 * extensions): an untrusted file is skipped, naming its digest; a trusted
 * one loads; and a file edited since it was trusted is new code nobody has
 * trusted yet. Trust is the root's code trust, the one sandboxed code is
 * trusted in.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { trustExtension, writeExtension } from "@kb/test-kit";
import { bunFileSystemLayer } from "../src/platform.ts";
import { registryFor, resetRegistryCache } from "../src/registry.ts";

const HELLO = `export default [{
  id: "hello",
  title: "Hello",
  description: "a repository extension",
  mode: { kind: "read" },
  inputSchema: { parse: (input) => input },
  outputSchema: { parse: (output) => output },
  handler: async () => ({ hello: true }),
}];
`;

let root = "";

const registry = () => {
  resetRegistryCache();
  return Effect.runPromise(registryFor(root).pipe(Effect.provide(bunFileSystemLayer)));
};
const loads = async () => (await registry()).actions.some((a) => a.def.id === "ext.hello.hello");

describe("a root's repository extensions", () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-extension-trust-"));
  });
  afterEach(async () => {
    resetRegistryCache();
    await rm(root, { recursive: true, force: true });
  });

  test("an untrusted file is never imported, and its failure names its digest", async () => {
    await writeExtension(root, "hello.ts", HELLO);
    const { failures } = await registry();
    expect(await loads()).toBe(false);
    expect(failures).toEqual([
      {
        file: "hello.ts",
        error: expect.stringMatching(/^not trusted on this machine \(sha256:[0-9a-f]{64}\)/),
      },
    ]);
  });

  test("a trusted file loads, and an edit since is untrusted again", async () => {
    await writeExtension(root, "hello.ts", HELLO);
    await trustExtension(root, HELLO);
    expect(await loads()).toBe(true);
    await writeExtension(root, "hello.ts", HELLO.replace("hello: true", "hello: false"));
    expect(await loads()).toBe(false);
  });
});
