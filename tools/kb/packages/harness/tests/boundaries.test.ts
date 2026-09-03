import { describe, expect, test } from "bun:test";
import { LAYER_ALLOWS, SCOPE_ALLOWS } from "../src/constraints.ts";
import { importEdges } from "../src/import-graph.ts";
import { internalEdges, projectGraph } from "../src/project-graph.ts";
import { axisValues, dependencyEntries, workspacePackages } from "../src/workspace.ts";

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
  const tagsByProject = new Map(
    Object.entries(graph.nodes).map(([name, node]) => [name, node.data.tags ?? []]),
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
      for (const axis of ["layer", "scope"] as const) {
        const problem = violation(edge.source, edge.target, axis);
        if (problem) violations.push(`${problem}  [${edge.file}]`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("every manifest edge satisfies both axes of the matrix", () => {
    const violations: string[] = [];
    for (const edge of internalEdges(graph)) {
      for (const axis of ["layer", "scope"] as const) {
        const problem = violation(edge.source, edge.target, axis);
        if (problem) violations.push(`${problem}  [manifest]`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("every imported workspace package is also declared", () => {
    // Hoisting makes an undeclared import work until it does not: the nix
    // build of @kb/ui failed on exactly this for `three`.
    const declared = new Map(
      workspacePackages().map(({ manifest }) => [
        manifest.name!,
        new Set(
          dependencyEntries(manifest)
            .map(([, name]) => name)
            .filter((n) => n.startsWith("@kb/")),
        ),
      ]),
    );
    const missing = new Set<string>();
    for (const edge of importEdges()) {
      if (!declared.get(edge.source)?.has(edge.target)) {
        missing.add(`${edge.source} imports ${edge.target} without declaring it`);
      }
    }
    const list = [...missing].sort();
    expect(list, list.join("\n")).toEqual([]);
  });
});
