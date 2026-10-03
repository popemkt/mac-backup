/**
 * A throwaway `packages/` tree: one manifest and its source files per
 * package.
 *
 * A red case is usually a spelling the workspace does not contain (the real
 * tree is clean, which is the point), so it has to be built. Every reader the
 * gates use takes a packages root, so a fixture runs the same functions the
 * real checks call, over two packages instead of thirty.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface FixturePackage {
  /** `<layer>/<name>` under the fixture's packages root. */
  dir: string;
  name: string;
  scope: string;
  /** Tags beside the scope tag, such as `family:<name>`. */
  tags?: readonly string[];
  /** Source files, keyed by package-relative path. */
  files: Record<string, string>;
  /** `compilerOptions.paths`, when the case is about an alias. */
  paths?: Record<string, string[]>;
}

const fixtureRoots: string[] = [];

/** Builds the tree and returns its packages root. */
export function fixtureWorkspace(packages: readonly FixturePackage[]): string {
  const root = mkdtempSync(join(tmpdir(), "kb-harness-fixture-"));
  fixtureRoots.push(root);
  const packagesRoot = join(root, "packages");
  for (const pkg of packages) {
    const dir = join(packagesRoot, pkg.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: pkg.name,
        exports: { ".": "./src/index.ts" },
        nx: { tags: [`scope:${pkg.scope}`, ...(pkg.tags ?? [])] },
      }),
    );
    if (pkg.paths !== undefined) {
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { paths: pkg.paths } }),
      );
    }
    for (const [file, source] of Object.entries(pkg.files)) {
      const path = join(dir, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
    }
  }
  return packagesRoot;
}

/** Removes every tree this module built; a test file calls it from `afterAll`. */
export function removeFixtureWorkspaces(): void {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
}
