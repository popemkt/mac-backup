import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { EXTENSION_ROOTS, familyEdgeViolation, isPackageTestFile } from "../src/constraints.ts";
import {
  browserHalfProblems,
  declaredNames,
  extensionRootBreaches,
  familyProblems,
  rootReExports,
  staleRootSanctions,
  unpairedExtensions,
} from "../src/families.ts";
import { importEdges } from "../src/import-graph.ts";
import {
  PACKAGES_ROOT,
  dependencyEntries,
  packageAxes,
  workspacePackages,
} from "../src/workspace.ts";
import {
  type FixturePackage,
  fixtureWorkspace,
  removeFixtureWorkspaces,
} from "./fixture-workspace.ts";

afterAll(removeFixtureWorkspaces);

/**
 * The family axis and the composition-root fence (DESIGN.md → Extension
 * families → Enforcement): "core names no feature", checked rather than
 * prose.
 *
 * - every extension package carries one `family:` tag, equal to the name its
 *   family's `defineExtension` declares — the declaration is the one home of
 *   the name, and the tag a checked reading of it;
 * - an extension package imports another extension package only of its own
 *   family;
 * - an `app` package imports an extension package only from a file of
 *   `EXTENSION_ROOTS`, or from a file named in `EXTENSION_ROOT_BREACHES`,
 *   and a root re-exports none;
 * - every extension package is loaded, by a value import, by a root of each
 *   host its scope runs in;
 * - a family's browser half is its one `@kb/<family>-ui` package, not a
 *   surface of `@kb/ui`.
 *
 * Each rule has a red fixture below: a tree built to break it, run through
 * the same function as the real workspace.
 */

const declares = (name: string): string =>
  `import { defineExtension } from "@kb/contracts";\nexport const x = defineExtension({ name: "${name}", label: "X" });\n`;

describe("extension families over the workspace", () => {
  test("each family's browser half is its one -ui package", () => {
    const problems = browserHalfProblems();
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("every family tag equals its family's one declaration", () => {
    const problems = familyProblems();
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("an extension package imports another only of its own family", () => {
    const axesOf = packageAxes();
    const violations = [
      ...importEdges().map((edge) => ({ ...edge, at: edge.file })),
      ...workspacePackages().flatMap(({ name, manifest }) =>
        dependencyEntries(manifest).map(([, target]) => ({
          source: name,
          target,
          at: "manifest",
        })),
      ),
    ]
      .flatMap(({ source, target, at }) => {
        const problem = familyEdgeViolation(axesOf, source, target);
        return problem === undefined ? [] : [`${problem}  [${at}]`];
      })
      .toSorted();
    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("an app package imports an extension package only from a composition root", () => {
    const unsanctioned = extensionRootBreaches()
      .filter((breach) => breach.sanction === undefined)
      .map((breach) => `${breach.source} ${breach.file} -> ${breach.target}`)
      .toSorted();
    expect(
      unsanctioned,
      `Imports of an extension package outside EXTENSION_ROOTS (move the wiring into a root, or file a #gap and add a sanctioned row):\n${unsanctioned.join("\n")}`,
    ).toEqual([]);
  });

  test("no sanctioned breach outlives its import", () => {
    const stale = staleRootSanctions();
    expect(stale, stale.join("\n")).toEqual([]);
  });

  test("every composition root names a file that exists", () => {
    const names = new Map(workspacePackages().map((pkg) => [pkg.name, pkg.dir]));
    const missing = Object.entries(EXTENSION_ROOTS).flatMap(([source, roots]) =>
      roots
        .filter(({ file }) => {
          const dir = names.get(source);
          return dir === undefined || !existsSync(join(PACKAGES_ROOT, dir, file));
        })
        .map(({ file }) => `${source} ${file}`),
    );
    expect(missing, missing.join("\n")).toEqual([]);
  });

  test("no root re-exports an extension package", () => {
    const leaks = rootReExports();
    expect(leaks, leaks.join("\n")).toEqual([]);
  });

  test("every extension package is loaded by a host", () => {
    const unpaired = unpairedExtensions();
    expect(unpaired, unpaired.join("\n")).toEqual([]);
  });
});

describe("what counts as a test file", () => {
  test("the package's own tests folder and test suffixes, never a tests folder inside src", () => {
    expect(isPackageTestFile("tests/x.ts")).toBe(true);
    expect(isPackageTestFile("tests-render/x.e2e.ts")).toBe(true);
    expect(isPackageTestFile("src/lib/x.test.tsx")).toBe(true);
    expect(isPackageTestFile("src/lib/tests/x.ts")).toBe(false);
    expect(isPackageTestFile("src/tests-render/x.ts")).toBe(false);
  });
});

describe("a family's name is read off its declaration", () => {
  test("a literal name is read, and anything else is not a name", () => {
    expect(declaredNames("x.ts", declares("chart"))).toEqual(["chart"]);
    expect(
      declaredNames(
        "x.ts",
        'import { defineExtension } from "@kb/contracts";\nconst n = "chart";\nexport const x = defineExtension({ name: n, label: "X" });\n',
      ),
    ).toEqual([undefined]);
    expect(declaredNames("x.ts", 'export const name = "chart";\n')).toEqual([]);
  });

  test.each([
    [
      "an aliased import",
      'import { defineExtension as d } from "@kb/contracts";\nexport const x = d({ name: "chart", label: "X" });\n',
    ],
    [
      "a member call",
      'import * as contracts from "@kb/contracts";\nexport const x = contracts.defineExtension({ name: "chart", label: "X" });\n',
    ],
    [
      "a computed member call",
      'import * as contracts from "@kb/contracts";\nexport const x = contracts["defineExtension"]({ name: "chart", label: "X" });\n',
    ],
    [
      "a computed key",
      'import { defineExtension } from "@kb/contracts";\nconst k = "name";\nexport const x = defineExtension({ [k]: "chart", label: "X" });\n',
    ],
    [
      "a spread that may carry the name",
      'import { defineExtension } from "@kb/contracts";\nconst base = { name: "chart" };\nexport const x = defineExtension({ ...base, name: "chart", label: "X" });\n',
    ],
    [
      "the function passed on as a value",
      'import { defineExtension } from "@kb/contracts";\nexport const declare = defineExtension;\n',
    ],
  ])("%s fails closed", (_, source) => {
    expect(declaredNames("x.ts", source)).toContain(undefined);
  });
});

/** A two-package canvas family and a docs family, the shape of today's tree. */
const CANVAS: FixturePackage = {
  dir: "extension/canvas",
  name: "@kb/canvas",
  scope: "shared",
  tags: ["family:canvas"],
  files: { "src/index.ts": declares("canvas") },
};
const EXT_CANVAS: FixturePackage = {
  dir: "extension/ext-canvas",
  name: "@kb/ext-canvas",
  scope: "backend",
  tags: ["family:canvas"],
  files: { "src/index.ts": 'import "@kb/canvas";\n' },
};
const EXT_DOCS: FixturePackage = {
  dir: "extension/ext-docs",
  name: "@kb/ext-docs",
  scope: "backend",
  tags: ["family:docs"],
  files: { "src/index.ts": declares("docs") },
};

/** The server's root, loading both families' backend packages. */
function runtime(files: Record<string, string> = {}): FixturePackage {
  return {
    dir: "app/runtime",
    name: "@kb/runtime",
    scope: "backend",
    files: { "src/bundled.ts": 'import "@kb/ext-canvas";\nimport "@kb/ext-docs";\n', ...files },
  };
}

describe("red fixtures: the family tag", () => {
  test("the clean tree has no problem", () => {
    expect(familyProblems(fixtureWorkspace([CANVAS, EXT_CANVAS, EXT_DOCS]))).toEqual([]);
  });

  test("an extension package without a family tag fails", () => {
    const root = fixtureWorkspace([CANVAS, EXT_CANVAS, { ...EXT_DOCS, tags: [] }]);
    expect(familyProblems(root)).toEqual([
      "extension/ext-docs: family tags []; an extension package carries exactly one",
    ]);
  });

  test("a tag that differs from the declaration fails", () => {
    const root = fixtureWorkspace([CANVAS, EXT_CANVAS, { ...EXT_DOCS, tags: ["family:doc"] }]);
    expect(familyProblems(root)).toEqual([
      'extension/ext-docs/src/index.ts: declares "docs", but its package is tagged family:doc',
    ]);
  });

  test("a family that never declares itself fails", () => {
    const root = fixtureWorkspace([
      { ...CANVAS, files: { "src/index.ts": "export {};\n" } },
      EXT_CANVAS,
    ]);
    expect(familyProblems(root)).toEqual([
      "family:canvas: no package of the family calls defineExtension, so its name has no home",
    ]);
  });

  test("a family tag outside the extension layer fails", () => {
    const root = fixtureWorkspace([CANVAS, EXT_CANVAS, { ...runtime(), tags: ["family:canvas"] }]);
    expect(familyProblems(root)).toEqual([
      'app/runtime: family tags ["canvas"] outside the extension layer',
    ]);
  });
});

describe("red fixtures: family edges", () => {
  test("ext-docs importing @kb/canvas crosses families; ext-canvas importing it does not", () => {
    const root = fixtureWorkspace([
      CANVAS,
      EXT_CANVAS,
      { ...EXT_DOCS, files: { "src/index.ts": `${declares("docs")}import "@kb/canvas";\n` } },
    ]);
    const axesOf = packageAxes(workspacePackages(root));
    const verdicts = importEdges(root)
      .filter((edge) => edge.target === "@kb/canvas")
      .map((edge) => [edge.source, familyEdgeViolation(axesOf, edge.source, edge.target)]);
    expect(verdicts).toEqual([
      ["@kb/ext-canvas", undefined],
      ["@kb/ext-docs", "@kb/ext-docs (family:docs) -> @kb/canvas (family:canvas)"],
    ]);
  });
});

describe("red fixtures: the composition-root fence", () => {
  const roots = { "@kb/runtime": [{ file: "src/bundled.ts", hosts: ["server"] as const }] };

  test("layers.ts importing an extension package is a breach; the root and a test are not", () => {
    const root = fixtureWorkspace([
      CANVAS,
      EXT_CANVAS,
      EXT_DOCS,
      runtime({
        "src/layers.ts": 'import "@kb/ext-docs";\n',
        "tests/layers.test.ts": 'import "@kb/ext-docs";\n',
      }),
    ]);
    expect(
      extensionRootBreaches(root, roots, {}).map((breach) => `${breach.file} -> ${breach.target}`),
    ).toEqual(["src/layers.ts -> @kb/ext-docs"]);
  });

  const sanctioned = {
    "@kb/runtime": [{ target: "@kb/ext-docs", files: ["src/legacy/a.ts", "src/legacy/b.ts"] }],
  };

  test("a named file is sanctioned, and a new file beside it is not", () => {
    const root = fixtureWorkspace([
      CANVAS,
      EXT_CANVAS,
      EXT_DOCS,
      runtime({
        "src/legacy/a.ts": 'import "@kb/ext-docs";\n',
        "src/legacy/b.ts": 'import "@kb/ext-docs";\n',
        "src/legacy/new.ts": 'import "@kb/ext-docs";\n',
      }),
    ]);
    expect(
      extensionRootBreaches(root, roots, sanctioned)
        .map(
          (breach) =>
            `${breach.file} ${breach.sanction === undefined ? "unsanctioned" : "sanctioned"}`,
        )
        .toSorted(),
    ).toEqual([
      "src/legacy/a.ts sanctioned",
      "src/legacy/b.ts sanctioned",
      "src/legacy/new.ts unsanctioned",
    ]);
    expect(staleRootSanctions(root, roots, sanctioned)).toEqual([]);
  });

  test("a named file that stops importing goes stale, though its row has another live file", () => {
    const root = fixtureWorkspace([
      CANVAS,
      EXT_CANVAS,
      EXT_DOCS,
      runtime({ "src/legacy/a.ts": 'import "@kb/ext-docs";\n', "src/legacy/b.ts": "export {};\n" }),
    ]);
    expect(staleRootSanctions(root, roots, sanctioned)).toEqual([
      "@kb/runtime src/legacy/b.ts -> @kb/ext-docs: no such import any more",
    ]);
  });

  test("a root that re-exports an extension package leaks it", () => {
    const root = fixtureWorkspace([
      CANVAS,
      EXT_CANVAS,
      EXT_DOCS,
      runtime({
        "src/bundled.ts":
          'import { x } from "@kb/ext-docs";\nimport "@kb/ext-canvas";\nexport { x };\nexport { y } from "@kb/canvas";\nexport const own = [x];\n',
      }),
    ]);
    expect(rootReExports(root, roots)).toEqual([
      "@kb/runtime src/bundled.ts re-exports @kb/canvas",
      "@kb/runtime src/bundled.ts re-exports @kb/ext-docs",
    ]);
  });
});

/** The browser's root, whatever the case writes in it. */
function ui(source: string): FixturePackage {
  return {
    dir: "app/ui",
    name: "@kb/ui",
    scope: "browser",
    files: { "src/ui-plugins.ts": source },
  };
}

describe("red fixtures: pairing", () => {
  const roots = {
    "@kb/runtime": [{ file: "src/bundled.ts", hosts: ["server"] as const }],
    "@kb/ui": [{ file: "src/ui-plugins.ts", hosts: ["browser"] as const }],
  };
  const CANVAS_UI: FixturePackage = {
    dir: "extension/canvas-ui",
    name: "@kb/canvas-ui",
    scope: "browser",
    tags: ["family:canvas"],
    files: { "src/index.ts": 'import "@kb/canvas";\n' },
  };

  test("a -ui package the browser root loads is paired", () => {
    const root = fixtureWorkspace([
      CANVAS,
      EXT_CANVAS,
      EXT_DOCS,
      CANVAS_UI,
      runtime(),
      ui('import "@kb/canvas-ui";\n'),
    ]);
    expect(unpairedExtensions(root, roots)).toEqual([]);
  });

  test("a -ui package missing from the browser root is a dead seam", () => {
    const root = fixtureWorkspace([
      CANVAS,
      EXT_CANVAS,
      EXT_DOCS,
      CANVAS_UI,
      runtime(),
      ui("export {};\n"),
    ]);
    expect(unpairedExtensions(root, roots)).toEqual([
      "@kb/canvas-ui (scope:browser): no browser root loads it",
    ]);
  });

  test("a backend package no server root loads, and a shared one nothing reaches, are dead seams", () => {
    const root = fixtureWorkspace([
      CANVAS,
      { ...EXT_CANVAS, files: { "src/index.ts": "export {};\n" } },
      EXT_DOCS,
      runtime({ "src/bundled.ts": 'import "@kb/ext-docs";\n' }),
    ]);
    expect(unpairedExtensions(root, roots)).toEqual([
      "@kb/canvas (scope:shared): no root and no loaded package of family:canvas loads it",
      "@kb/ext-canvas (scope:backend): no server root loads it",
    ]);
  });

  test("a type-only import in a root loads nothing", () => {
    const root = fixtureWorkspace([
      CANVAS,
      EXT_CANVAS,
      EXT_DOCS,
      runtime({
        "src/bundled.ts":
          'import "@kb/ext-docs";\nimport type { X } from "@kb/ext-canvas";\nexport type Y = X;\n',
      }),
    ]);
    expect(unpairedExtensions(root, roots)).toEqual([
      "@kb/canvas (scope:shared): no root and no loaded package of family:canvas loads it",
      "@kb/ext-canvas (scope:backend): no server root loads it",
    ]);
  });

  test("a shared package is reached only through a sibling that is itself loaded", () => {
    // ext-canvas still imports @kb/canvas, but nothing loads ext-canvas.
    const root = fixtureWorkspace([
      CANVAS,
      EXT_CANVAS,
      EXT_DOCS,
      runtime({ "src/bundled.ts": 'import "@kb/ext-docs";\n' }),
    ]);
    expect(unpairedExtensions(root, roots)).toEqual([
      "@kb/canvas (scope:shared): no root and no loaded package of family:canvas loads it",
      "@kb/ext-canvas (scope:backend): no server root loads it",
    ]);
  });
});

describe("red fixtures: browser halves", () => {
  const CANVAS_UI: FixturePackage = {
    dir: "extension/canvas-ui",
    name: "@kb/canvas-ui",
    scope: "browser",
    tags: ["family:canvas"],
    files: { "src/index.ts": "export {};\n" },
  };

  test("a family's browser package is named for it, and a -ui package is a browser one", () => {
    const misnamed = fixtureWorkspace([
      CANVAS,
      { ...CANVAS_UI, dir: "extension/canvas-pages", name: "@kb/canvas-pages" },
    ]);
    expect(browserHalfProblems(misnamed, [], new Set())).toEqual([
      "@kb/canvas-pages: a browser package of family:canvas is its browser half, @kb/canvas-ui",
    ]);
    const shared = fixtureWorkspace([CANVAS, { ...CANVAS_UI, scope: "shared" }]);
    expect(browserHalfProblems(shared, [], new Set())).toEqual([
      "@kb/canvas-ui: a -ui package is a browser half, scope:browser, not scope:shared",
    ]);
    expect(browserHalfProblems(fixtureWorkspace([CANVAS, CANVAS_UI]), [], new Set())).toEqual([]);
  });

  test("a surface of @kb/ui named for a family is a half in core, unless sanctioned", () => {
    const root = fixtureWorkspace([CANVAS, EXT_DOCS]);
    expect(browserHalfProblems(root, ["canvas", "outline"], new Set())).toEqual([
      "@kb/ui components/canvas: family:canvas's browser half is a surface of core, not @kb/canvas-ui",
    ]);
    expect(browserHalfProblems(root, ["canvas", "outline"], new Set(["canvas"]))).toEqual([]);
    expect(browserHalfProblems(root, ["outline"], new Set(["canvas"]))).toEqual([
      "CORE_BROWSER_HALVES names canvas, which is no longer a surface of @kb/ui",
    ]);
  });
});
