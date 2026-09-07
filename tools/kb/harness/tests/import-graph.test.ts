import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { matrixViolation } from "../src/constraints.ts";
import { importEdges, resolvedImports, specifiersOf, surfaceBypass } from "../src/import-graph.ts";
import { packageAxes, workspacePackages } from "../src/workspace.ts";

/**
 * Harness check: import extraction is a parse, not a scan (wave t2).
 *
 * `boundaries` is only as honest as the edges it is given, and the regex this
 * replaced asked the wrong question: it matched the word `from`, so a
 * side-effect `import "@kb/x"` produced no edge at all and `export { x } from
 * "@kb/y"` produced one only because that word happens to appear. A fence with
 * an invisible form is not a fence — you can cross it by choosing a syntax.
 *
 * Red case: put the old `/(?:\bfrom\s*|…)/` back and the first two
 * expectations below fail.
 */
describe("import-graph", () => {
  test("a side-effect import and an `export … from` are both sites", () => {
    const source = `import "@kb/side-effect";
export { x } from "@kb/reexport";
`;
    expect(specifiersOf("fixture.ts", source)).toEqual(["@kb/side-effect", "@kb/reexport"]);
  });

  test("every other import form the workspace can write is a site", () => {
    const source = `import { a } from "@kb/named";
import type { B } from "@kb/type-only";
import * as ns from "@kb/namespace";
export * from "@kb/star";
export * as bag from "@kb/star-as";
const lazy = await import("@kb/dynamic");
void lazy;
void ns;
`;
    expect(specifiersOf("fixture.ts", source).toSorted()).toEqual([
      "@kb/dynamic",
      "@kb/named",
      "@kb/namespace",
      "@kb/star",
      "@kb/star-as",
      "@kb/type-only",
    ]);
  });

  test("a specifier named only in a comment or a string is not a site", () => {
    const source = `// import { a } from "@kb/commented";
/* export { b } from "@kb/blocked"; */
const s = 'import { c } from "@kb/quoted"';
void s;
`;
    expect(specifiersOf("fixture.ts", source)).toEqual([]);
  });

  test("a computed dynamic import contributes no specifier", () => {
    const source = `const which = "@kb/model";
const m = await import(which);
void m;
`;
    expect(specifiersOf("fixture.ts", source)).toEqual([]);
  });

  test("tsx parses as tsx", () => {
    const source = `import { Thing } from "@kb/ui-bits";
export const El = () => <Thing<string> value="x" />;
`;
    expect(specifiersOf("fixture.tsx", source)).toEqual(["@kb/ui-bits"]);
  });

  test("a file that does not parse fails loudly rather than reporting no imports", () => {
    expect(() => specifiersOf("broken.ts", "import { from '@kb/x'\n")).toThrow("broken.ts");
  });
});

/**
 * A throwaway `packages/` tree: one manifest and one source file per package.
 *
 * Bypasses are spellings the workspace does not currently contain (the real
 * tree is clean, which is the point), so the red case for each has to be
 * built. Every reader the graph uses takes a packages root, so these are the
 * same functions the real checks call, over two packages instead of twenty.
 */
interface FixturePackage {
  /** `<layer>/<name>` under the fixture's packages root. */
  dir: string;
  name: string;
  scope: string;
  /** Source files, keyed by package-relative path. */
  files: Record<string, string>;
  /** `compilerOptions.paths`, when the case is about an alias. */
  paths?: Record<string, string[]>;
}

const fixtureRoots: string[] = [];

function fixtureWorkspace(packages: readonly FixturePackage[]): string {
  const root = mkdtempSync(join(tmpdir(), "kb-import-graph-"));
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
        nx: { tags: [`scope:${pkg.scope}`] },
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

afterAll(() => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

/** `domain/low` may import only `domain`; `app/high` is two axes away. */
const LOW: Omit<FixturePackage, "files"> = { dir: "domain/low", name: "@kb/low", scope: "shared" };
const HIGH: FixturePackage = {
  dir: "app/high",
  name: "@kb/high",
  scope: "backend",
  files: { "src/index.ts": "export const high = 1;\n", "src/deep.ts": "export const deep = 2;\n" },
};

/** The one importing file of the `low` package, whatever the case writes in it. */
function lowImports(source: string, file = "src/index.ts"): string {
  return fixtureWorkspace([{ ...LOW, files: { [file]: source } }, HIGH]);
}

describe("import-graph bypasses", () => {
  /**
   * Red before the resolver landed: `importEdges` matched `/^@kb\/[a-z0-9-]+$/`
   * on the raw specifier, so a subpath produced no edge and no breach — the
   * layer, scope, isomorphism and public-surface fences all saw nothing.
   */
  test("a @kb subpath is an edge to the package and a surface breach", () => {
    const root = lowImports(
      'import { deep } from "@kb/high/src/deep.ts";\nexport const x = deep;\n',
    );
    expect(importEdges(root)).toEqual([
      { source: "@kb/low", target: "@kb/high", file: "src/index.ts" },
    ]);
    expect(resolvedImports(root).map(surfaceBypass)).toEqual([
      '@kb/low imports "@kb/high/src/deep.ts", reaching past @kb/high\'s barrel  [src/index.ts]',
    ]);
  });

  test("the matrix rejects the subpath edge on both axes", () => {
    const root = lowImports(
      'import { deep } from "@kb/high/src/deep.ts";\nexport const x = deep;\n',
    );
    const axesOf = packageAxes(workspacePackages(root));
    const edge = importEdges(root)[0];
    expect(edge).toBeDefined();
    expect(
      (["layer", "scope"] as const).map((axis) =>
        matrixViolation(axesOf, edge?.source ?? "", edge?.target ?? "", axis),
      ),
    ).toEqual([
      "@kb/low (layer:domain) -> @kb/high (layer:app)",
      "@kb/low (scope:shared) -> @kb/high (scope:backend)",
    ]);
  });

  test("a relative path out of the package is an edge and a surface breach", () => {
    const root = lowImports(
      'import { deep } from "../../../app/high/src/deep.ts";\nexport const x = deep;\n',
    );
    expect(importEdges(root)).toEqual([
      { source: "@kb/low", target: "@kb/high", file: "src/index.ts" },
    ]);
    expect(resolvedImports(root).map(surfaceBypass)).toEqual([
      '@kb/low imports "../../../app/high/src/deep.ts", reaching @kb/high without naming it  [src/index.ts]',
    ]);
  });

  test("a relative path inside the package is neither", () => {
    const root = fixtureWorkspace([
      {
        ...LOW,
        files: {
          "src/index.ts": 'import { own } from "./own.ts";\nexport const x = own;\n',
          "src/own.ts": "export const own = 3;\n",
        },
      },
      HIGH,
    ]);
    expect(importEdges(root)).toEqual([]);
    expect(resolvedImports(root).map(surfaceBypass).filter(Boolean)).toEqual([]);
  });

  test("a relative path under no package at all is a surface breach", () => {
    const root = lowImports(
      'import { out } from "../../../../outside.ts";\nexport const x = out;\n',
    );
    expect(importEdges(root)).toEqual([]);
    expect(resolvedImports(root).map(surfaceBypass)).toEqual([
      '@kb/low imports "../../../../outside.ts", which resolves to ../outside.ts, under no package  [src/index.ts]',
    ]);
  });

  test("a tsconfig path alias resolves through to package ownership", () => {
    // `@/…` is @kb/ui's intra-package spelling of a relative import. Read as a
    // bare specifier it looks third-party, so an alias retargeted at another
    // package would be an edge nothing sees.
    const root = fixtureWorkspace([
      {
        ...LOW,
        paths: { "@/*": ["./src/*"], "@out/*": ["../../app/high/src/*"] },
        files: {
          "src/index.ts":
            'import { own } from "@/own.ts";\nimport { deep } from "@out/deep.ts";\nexport const x = own + deep;\n',
          "src/own.ts": "export const own = 3;\n",
        },
      },
      HIGH,
    ]);
    expect(importEdges(root)).toEqual([
      { source: "@kb/low", target: "@kb/high", file: "src/index.ts" },
    ]);
    expect(resolvedImports(root).map(surfaceBypass).filter(Boolean)).toEqual([
      '@kb/low imports "@out/deep.ts", reaching @kb/high without naming it  [src/index.ts]',
    ]);
  });

  test("a bare npm specifier is not a workspace edge", () => {
    const root = lowImports('import { z } from "zod";\nexport const x = z;\n');
    expect(importEdges(root)).toEqual([]);
    expect(resolvedImports(root).map(surfaceBypass).filter(Boolean)).toEqual([]);
  });

  test.each([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"])(
    "a %s file is scanned like every other source",
    (ext) => {
      // Red before the fix: SOURCE_EXT was [".ts", ".tsx"], so an import in any
      // of the other six was invisible to every fence at once.
      const root = lowImports(
        'import { high } from "@kb/high";\nexport const x = high;\n',
        `src/index${ext}`,
      );
      expect(importEdges(root)).toEqual([
        { source: "@kb/low", target: "@kb/high", file: `src/index${ext}` },
      ]);
    },
  );
});
