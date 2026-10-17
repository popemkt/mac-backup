/**
 * A repository extension runs with the server's reach, so a root's
 * `.kb/extensions/*.ts` is imported only once a person has trusted it on
 * this machine (DESIGN.md → Core boundary & extensions → repository
 * extensions): an untrusted file is skipped, naming its digest; a trusted
 * one loads; and a file edited since it was trusted is new code nobody has
 * trusted yet. Trust is the root's code trust, the one sandboxed code is
 * trusted in.
 *
 * Trust covers what it loads: a helper the root carries that a trusted file
 * names never runs, however it is resolved (a static or a literal dynamic
 * import, a require, a path alias or an import map the root configures, a
 * query Bun would read past its hooks; inside the extensions directory or
 * out of it, through a link or not, or a package the root carries), and one
 * that does not resolve refuses it too; an extension that is a link out of the
 * directory is refused; what is imported is the source whose digest was
 * trusted, even when the file, or the file a link names, changes after the
 * digest is read; and a digest trusted later in the same process is the one
 * that runs. What the approved code loads or evaluates when it runs (a
 * computed import, a require it builds, an import made by a function it
 * makes, an eval) is what the bytes a person read do, and it runs.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
      ["a static import of another file", `import "./lib/helper.ts";`],
      ["an import out of the extensions directory", `import "../../outside.ts";`],
      ["a static import of a helper that links out", `import "./lib/link.ts";`],
      ["a package the root carries", `import "carried";`],
      ["a package the root carries through a link", `import "linked";`],
      ["a require", `const { helped } = require("./lib/helper.ts");`],
      ["a literal import()", `await import("../../outside.ts");`],
      ["a tsconfig path", `import "@helpers/outside";`],
      ["a package import", `import "#outside";`],
      // Bun reads such a specifier from disk, past its load hooks.
      ["an import whose query holds a colon", `import "../../outside.ts?a:b";`],
      ["an import that does not resolve", `import "./lib/missing.ts";`],
    ])("%s never runs the helper, and the extension is refused", async (_how, prelude) => {
      const mark = join(root, "ran");

      // Beside the extension, where discovery does not look, and trusted by nobody.
      await mkdir(join(root, ".kb", "extensions", "lib"), { recursive: true });
      await writeFile(join(root, ".kb", "extensions", "lib", "helper.ts"), helper(mark));
      await writeFile(join(root, "outside.ts"), helper(mark));
      await symlink(join(root, "outside.ts"), join(root, ".kb", "extensions", "lib", "link.ts"));
      // Resolution the root configures: a path alias, and an import map.
      await writeFile(
        join(root, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { paths: { "@helpers/*": ["./*"] } } }),
      );
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "root", imports: { "#outside": "./outside.ts" } }),
      );
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
      // A package the root links to elsewhere in itself is the root's all the same.
      const vendored = join(root, "vendor", "linked");
      await mkdir(vendored, { recursive: true });
      await writeFile(
        join(vendored, "package.json"),
        JSON.stringify({ name: "linked", main: "index.js" }),
      );
      await writeFile(
        join(vendored, "index.js"),
        helper(mark).replace("export const helped = true;", ""),
      );
      await symlink(vendored, join(root, "node_modules", "linked"));
      const source = extension(prelude);
      await writeTrustedExtension(root, "hello.ts", source);
      const { failures } = await registry();
      expect(await loads()).toBe(false);
      expect(failures).toEqual([
        { file: "hello.ts", error: expect.stringMatching(/no person approved|does not resolve/) },
      ]);
      expect(existsSync(mark)).toBe(false);
    });

    // What the approved bytes load or evaluate when they run is their own
    // doing, which the person read: no in-process hook sees every load.
    // GAP [[01M54NXDA4X8VZJ5DCZXX0PRHP]]
    test.each([
      ["a computed import", `await import(["..", "..", "outside.ts"].join("/"));`],
      ["a require of a name it builds", `const r = require; r("../../outside.ts");`],
      [
        "a require made from its own url",
        `import { createRequire } from "node:module";\ncreateRequire(import.meta.url)("../../outside.ts");`,
      ],
      [
        "an import built by a function it makes at runtime",
        `await new Function("p", "return im" + "port(p)")("../../outside.ts");`,
      ],
      ["an eval of a file it reads", `await eval(await Bun.file("OUTSIDE_JS").text());`],
    ])("%s loads what it names when it runs", async (_how, prelude) => {
      const mark = join(root, "ran");
      await writeFile(join(root, "outside.ts"), helper(mark));
      await writeFile(join(root, "outside.js"), `Bun.write(${JSON.stringify(mark)}, "ran");`);
      const source = extension(prelude.replace("OUTSIDE_JS", join(root, "outside.js")));
      await writeTrustedExtension(root, "hello.ts", source);
      expect(await loads()).toBe(true);
      expect(existsSync(mark)).toBe(true);
    });

    test("a digest trusted after another ran in this process is the one that runs", async () => {
      const said = async () =>
        (await registry()).actions.find((a) => a.def.id === "ext.hello.hello")?.def.description;
      await writeTrustedExtension(root, "hello.ts", HELLO);
      expect(await said()).toBe("a repository extension");
      const edited = HELLO.replace("a repository extension", "edited since");
      await writeExtension(root, "hello.ts", edited);
      expect(await said()).toBeUndefined();
      await trustExtension(root, edited);
      expect(await said()).toBe("edited since");
    });

    test("a file outside the root that imports one inside it is refused, however deep, and the root's never runs", async () => {
      const mark = join(root, "ran");
      await writeFile(join(root, "carried.ts"), helper(mark));
      // Outside the root: a file that imports one the root carries, and one that imports that file.
      const elsewhere = await mkdtemp(join(tmpdir(), "kb-outside-"));
      await writeFile(
        join(elsewhere, "inner.ts"),
        `import ${JSON.stringify(join(root, "carried.ts"))};\n`,
      );
      await writeFile(join(elsewhere, "outer.ts"), `import "./inner.ts";\n`);
      await writeTrustedExtension(
        root,
        "hello.ts",
        extension(`import ${JSON.stringify(join(elsewhere, "outer.ts"))};`),
      );
      const { failures } = await registry();
      expect(failures).toEqual([
        { file: "hello.ts", error: expect.stringContaining("no person approved") },
      ]);
      expect(existsSync(mark)).toBe(false);
      await rm(elsewhere, { recursive: true, force: true });
    });

    test.each([
      ["by its absolute path", (outside: string) => outside],
      ["through a link the root carries", (_outside: string, link: string) => link],
    ])("code outside the root, imported %s, is not the root's: it loads", async (_how, pick) => {
      const mark = join(root, "ran");
      const elsewhere = await mkdtemp(join(tmpdir(), "kb-outside-"));
      const outside = join(elsewhere, "installed.ts");
      await writeFile(outside, helper(mark));
      await mkdir(join(root, "vendor"), { recursive: true });
      const link = join(root, "vendor", "installed.ts");
      await symlink(outside, link);
      await writeTrustedExtension(
        root,
        "hello.ts",
        extension(`import ${JSON.stringify(pick(outside, link))};`),
      );
      expect(await loads()).toBe(true);
      expect(existsSync(mark)).toBe(true);
      await rm(elsewhere, { recursive: true, force: true });
    });

    test("an extension that is a link out of the extensions directory is refused, and never runs", async () => {
      const mark = join(root, "ran");
      await writeFile(join(root, "outside.ts"), extension(helper(mark)));
      await mkdir(join(root, ".kb", "extensions"), { recursive: true });
      await trustExtension(root, extension(helper(mark)));
      await symlink(join(root, "outside.ts"), join(root, ".kb", "extensions", "hello.ts"));
      const { failures } = await registry();
      expect(failures).toEqual([
        { file: "hello.ts", error: expect.stringContaining("links out of .kb/extensions") },
      ]);
      expect(existsSync(mark)).toBe(false);
    });

    test("a link within the directory runs the bytes that were trusted, not its target as it is by then", async () => {
      const dir = join(root, ".kb", "extensions", "lib");
      await mkdir(dir, { recursive: true });
      const target = join(dir, "hello-source.ts");
      await writeFile(target, HELLO);
      await symlink(target, join(root, ".kb", "extensions", "hello.ts"));
      const swapped = HELLO.replace("hello: true", "hello: false");
      const discovered = await Effect.runPromise(
        discoverExtensions(root).pipe(
          Effect.provideService(CodeTrust, {
            // The link's target changes after its digest is read, before it is imported.
            trusted: (digests) =>
              Effect.sync(() => {
                writeFileSync(target, swapped);
                return [...digests];
              }),
            trust: () => Effect.void,
            untrust: () => Effect.void,
          }),
          Effect.provide(bunFileSystemLayer),
        ),
      );
      const [action] = discovered.extensions.flatMap(({ actions }) => actions);
      expect(await action?.handler?.(undefined as never, undefined as never)).toEqual({
        hello: true,
      });
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
