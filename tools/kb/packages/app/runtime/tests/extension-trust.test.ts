/**
 * A repository extension runs with the server's reach, so a root's
 * `.kb/extensions/*.ts` is imported only once a person has trusted it on
 * this machine (DESIGN.md → Core boundary & extensions → repository
 * extensions): an untrusted file is skipped, naming its digest; a trusted
 * one loads; and a file edited since it was trusted is new code nobody has
 * trusted yet. Trust is the root's code trust, the one sandboxed code is
 * trusted in.
 *
 * Trust covers what runs: a helper a trusted file reaches for (another file,
 * by a static or a computed import, or a package the root carries) never
 * runs, and what is imported is the source whose digest was trusted, even
 * when the file changes after the digest is read.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { CodeTrust } from "@kb/contracts";
import { trustExtension, writeExtension, writeTrustedExtension } from "@kb/test-kit";
import { discoverExtensions } from "../src/extension-loader.ts";
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

/** A helper that leaves `ran` in the root when it runs. */
const helper = (mark: string) =>
  `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(mark)}, "ran");\nexport const helped = true;\n`;
const extension = (prelude: string) => `${prelude}\n${HELLO}`;

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

  describe("trust covers what runs", () => {
    test.each([
      ["a static import of another file", `import "./lib/helper.ts";`, "an extension is one file"],
      ["an import out of the extensions directory", `import "../../outside.ts";`, "one file"],
      [
        "a computed import of another file",
        `await import(["./lib/", "helper", ".ts"].join(""));`,
        "is not a verified extension",
      ],
      ["a package the root carries", `import "carried";`, "from inside the root"],
    ])("%s is refused, and the helper never runs", async (_how, prelude, why) => {
      const mark = join(root, "ran");
      // Beside the extension, where discovery does not look, and trusted by nobody.
      await mkdir(join(root, ".kb", "extensions", "lib"), { recursive: true });
      await writeFile(join(root, ".kb", "extensions", "lib", "helper.ts"), helper(mark));
      await writeFile(join(root, "outside.ts"), helper(mark));
      const pkg = join(root, "node_modules", "carried");
      await mkdir(pkg, { recursive: true });
      await writeFile(
        join(pkg, "package.json"),
        JSON.stringify({ name: "carried", main: "index.js" }),
      );
      await writeFile(
        join(pkg, "index.js"),
        helper(mark).replace("export const helped = true;", ""),
      );
      const source = extension(prelude);
      await writeTrustedExtension(root, "hello.ts", source);
      const { failures } = await registry();
      expect(await loads()).toBe(false);
      expect(failures).toEqual([{ file: "hello.ts", error: expect.stringContaining(why) }]);
      expect(existsSync(mark)).toBe(false);
    });

    test("what is imported is the source that was trusted, not the file as it is by then", async () => {
      const path = await writeTrustedExtension(root, "hello.ts", HELLO);
      const swapped = HELLO.replace("hello: true", "hello: false");
      const discovered = await Effect.runPromise(
        discoverExtensions(root).pipe(
          Effect.provideService(CodeTrust, {
            // The file changes after its digest is read, before it is imported.
            trusted: (digests) =>
              Effect.sync(() => {
                writeFileSync(path, swapped);
                return [...digests];
              }),
            trust: () => Effect.void,
            untrust: () => Effect.void,
          }),
          Effect.provide(bunFileSystemLayer),
        ),
      );
      expect(await readFile(path, "utf8")).toBe(swapped);
      const [action] = discovered.extensions.flatMap(({ actions }) => actions);
      expect(await action?.handler?.(undefined as never, undefined as never)).toEqual({
        hello: true,
      });
    });
  });
});
