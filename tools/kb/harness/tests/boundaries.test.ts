import { describe, expect, test } from "bun:test";
import {
  LAYER_ALLOWS,
  RUNTIME_ONLY_SPECIFIERS,
  SCOPE_ALLOWS,
  isIsomorphicScope,
  isTestKitDevDependency,
  testMayImportTestKit,
} from "../src/constraints.ts";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { importEdges, importSites, sourceFilesUnder, specifiersOf } from "../src/import-graph.ts";
import { internalEdges, projectGraph } from "../src/project-graph.ts";
import {
  axisValues,
  dependencyEntries,
  HARNESS_ROOT,
  WORKSPACE_ROOT,
  workspacePackages,
} from "../src/workspace.ts";

/**
 * Layer and scope direction (plan D11), over what the code actually imports.
 *
 * Projects and their tags come from `nx graph --file`. Edges come from the
 * import scanner, because Nx's own edges are manifest-derived here (see
 * src/import-graph.ts for the measurement). Manifest edges are checked too —
 * a package must declare what it imports — but they are not the fence.
 *
 * Red case (w1 report): add `import { JsonlStore } from "@kb/store-jsonl"` to
 * @kb/operations.
 */
describe("boundaries", () => {
  const graph = projectGraph();
  // The two axes describe workspace members. The root project carries the
  // harness's typecheck target and is not one, so it is not tagged and not
  // asked to be.
  const tagsByProject = new Map(
    Object.entries(graph.nodes)
      .filter(([, node]) => node.data.root.startsWith("packages/"))
      .map(([name, node]) => [name, node.data.tags ?? []]),
  );

  function violation(source: string, target: string, axis: "layer" | "scope"): string | null {
    const allows = axis === "layer" ? LAYER_ALLOWS : SCOPE_ALLOWS;
    const from = axisValues(tagsByProject.get(source) ?? [], axis)[0];
    const to = axisValues(tagsByProject.get(target) ?? [], axis)[0];
    if (from === undefined || to === undefined) return null;
    if ((allows[from] ?? []).includes(to)) return null;
    return `${source} (${axis}:${from}) -> ${target} (${axis}:${to})`;
  }

  test("every project carries exactly one layer and one scope tag", () => {
    const bad: string[] = [];
    for (const [name, tags] of tagsByProject) {
      const layers = axisValues(tags, "layer");
      const scopes = axisValues(tags, "scope");
      if (layers.length !== 1 || scopes.length !== 1) {
        bad.push(`${name}: layer=${JSON.stringify(layers)} scope=${JSON.stringify(scopes)}`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("every tag value is one the matrix knows", () => {
    const unknown: string[] = [];
    for (const [name, tags] of tagsByProject) {
      for (const layer of axisValues(tags, "layer")) {
        if (!(layer in LAYER_ALLOWS)) unknown.push(`${name}: layer:${layer}`);
      }
      for (const scope of axisValues(tags, "scope")) {
        if (!(scope in SCOPE_ALLOWS)) unknown.push(`${name}: scope:${scope}`);
      }
    }
    expect(unknown, unknown.join("\n")).toEqual([]);
  });

  test("every cross-package import satisfies both axes of the matrix", () => {
    const violations: string[] = [];
    for (const edge of importEdges()) {
      if (testMayImportTestKit(edge.file, edge.target)) continue;
      for (const axis of ["layer", "scope"] as const) {
        const problem = violation(edge.source, edge.target, axis);
        if (problem !== null) violations.push(`${problem}  [${edge.file}]`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("scope:shared source imports no runtime-only module (the isomorphism fence)", () => {
    // Red case: add `import { readFileSync } from "node:fs"` to
    // packages/domain/model/src.
    const violations: string[] = [];
    for (const { source, specifier, file } of importSites()) {
      const scope = axisValues(tagsByProject.get(source) ?? [], "scope")[0];
      if (scope === undefined || !isIsomorphicScope(scope)) continue;
      // `file` is package-relative, so the production tree is one prefix.
      if (!file.startsWith("src/")) continue;
      if (RUNTIME_ONLY_SPECIFIERS.test(specifier)) {
        violations.push(`${source} (scope:${scope}) -> ${specifier}  [${file}]`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("every manifest edge satisfies both axes of the matrix", () => {
    const violations: string[] = [];
    for (const edge of internalEdges(graph)) {
      if (isTestKitDevDependency(edge.target)) continue;
      for (const axis of ["layer", "scope"] as const) {
        const problem = violation(edge.source, edge.target, axis);
        if (problem !== null) violations.push(`${problem}  [manifest]`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("no harness file imports product code", () => {
    // The harness checks the workspace from outside it. An import of `@kb/*`,
    // or a relative path that climbs out of `harness/`, would make the checker
    // a member of the thing it checks — and would put it back in the matrix.
    // Red case: `import { present } from "../../packages/domain/model/src/present.ts"`.
    const violations: string[] = [];
    for (const file of sourceFilesUnder(HARNESS_ROOT)) {
      for (const specifier of specifiersOf(file, readFileSync(file, "utf8"))) {
        const rel = relative(WORKSPACE_ROOT, file);
        if (specifier.startsWith("@kb/")) {
          violations.push(`${rel} imports ${specifier}`);
        } else if (specifier.startsWith(".")) {
          const target = resolve(dirname(file), specifier);
          if (target !== HARNESS_ROOT && !target.startsWith(`${HARNESS_ROOT}${sep}`)) {
            violations.push(`${rel} imports ${specifier}, which resolves outside harness/`);
          }
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("every imported workspace package is also declared", () => {
    // Hoisting makes an undeclared import work until it does not: the nix
    // build of @kb/ui failed on exactly this for `three`.
    const declared = new Map(
      workspacePackages().map(({ name, manifest }) => [
        name,
        new Set(
          dependencyEntries(manifest)
            .map(([, dep]) => dep)
            .filter((n) => n.startsWith("@kb/")),
        ),
      ]),
    );
    const missing = new Set<string>();
    for (const edge of importEdges()) {
      if (testMayImportTestKit(edge.file, edge.target)) continue;
      if (declared.get(edge.source)?.has(edge.target) !== true) {
        missing.add(`${edge.source} imports ${edge.target} without declaring it`);
      }
    }
    const list = [...missing].toSorted();
    expect(list, list.join("\n")).toEqual([]);
  });
});
