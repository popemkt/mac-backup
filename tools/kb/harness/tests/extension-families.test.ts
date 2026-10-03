import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { EXTENSION_ROOTS, familyEdgeViolation } from "../src/constraints.ts";
import {
  declaredNames,
  extensionRootBreaches,
  familyProblems,
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
 *   `EXTENSION_ROOTS`, or on a sanctioned row of `EXTENSION_ROOT_BREACHES`;
 * - every extension package is loaded by a root of each host its scope runs
 *   in.
 *
 * Each rule has a red fixture below: a tree built to break it, run through
 * the same function as the real workspace.
 */

const declares = (name: string): string =>
  `import { defineExtension } from "@kb/contracts";\nexport const x = defineExtension({ name: "${name}", label: "X" });\n`;

describe("extension families over the workspace", () => {
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

  test("every extension package is loaded by a host", () => {
    const unpaired = unpairedExtensions();
    expect(unpaired, unpaired.join("\n")).toEqual([]);
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

  test("a sanctioned row covers its breach, and goes stale once the import leaves", () => {
    const sanctioned = { "@kb/runtime": [{ path: "src/legacy/", target: "@kb/ext-docs" }] };
    const breaching = fixtureWorkspace([
      CANVAS,
      EXT_CANVAS,
      EXT_DOCS,
      runtime({ "src/legacy/wire.ts": 'import "@kb/ext-docs";\n' }),
    ]);
    expect(
      extensionRootBreaches(breaching, roots, sanctioned).map((breach) => breach.sanction),
    ).toEqual([sanctioned["@kb/runtime"][0]]);
    expect(staleRootSanctions(breaching, roots, sanctioned)).toEqual([]);

    const moved = fixtureWorkspace([CANVAS, EXT_CANVAS, EXT_DOCS, runtime()]);
    expect(staleRootSanctions(moved, roots, sanctioned)).toEqual([
      "@kb/runtime src/legacy/ -> @kb/ext-docs: no such import any more",
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
      "@kb/canvas (scope:shared): no root and no package of family:canvas loads it",
      "@kb/ext-canvas (scope:backend): no server root loads it",
    ]);
  });
});
