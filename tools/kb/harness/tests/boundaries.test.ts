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
import {
  axisValues,
  dependencyEntries,
  HARNESS_ROOT,
  tagsOf,
  WORKSPACE_ROOT,
  workspacePackages,
} from "../src/workspace.ts";

/**
 * Layer and scope direction (plan D11), over what the code actually imports.
 *
 * Both axes come from the manifests and the tree: a package's layer is the
 * folder it sits in, its scope is the tag it carries. Edges come from the
 * import scanner. Manifest edges are checked too — a package must declare what
 * it imports — but they are not the fence.
 *
 * The Nx project graph used to supply the tags and the manifest edges. It
 * supplies neither now: layer moved into the tree, and Nx's edges were
 * measured to be manifest-derived only (see src/import-graph.ts), which is the
 * same list `dependencyEntries` returns without spawning `nx graph`.
 *
 * That every package has exactly one known layer and one known scope is
 * `workspace-shape`'s assertion, not this file's — this file is about
 * direction.
 *
 * Red case (w1 report): add `import { JsonlStore } from "@kb/store-jsonl"` to
 * @kb/operations.
 */
describe("boundaries", () => {
  const packages = workspacePackages();

  /** Both axes of one package: where it sits, and the runtime it must survive. */
  const axesOf = new Map(
    packages.map(({ name, layer, manifest }) => [
      name,
      { layer, scope: axisValues(tagsOf(manifest), "scope")[0] },
    ]),
  );

  function violation(source: string, target: string, axis: "layer" | "scope"): string | null {
    const allows = axis === "layer" ? LAYER_ALLOWS : SCOPE_ALLOWS;
    const from = axesOf.get(source)?.[axis];
    const to = axesOf.get(target)?.[axis];
    if (from === undefined || to === undefined) return null;
    if ((allows[from] ?? []).includes(to)) return null;
    return `${source} (${axis}:${from}) -> ${target} (${axis}:${to})`;
  }

  /** Every `@kb/*` dependency a manifest declares: the edges packages claim. */
  function declaredEdges(): Array<{ source: string; target: string }> {
    return packages.flatMap(({ name, manifest }) =>
      dependencyEntries(manifest)
        .map(([, dep]) => dep)
        .filter((dep) => dep.startsWith("@kb/"))
        .map((target) => ({ source: name, target })),
    );
  }

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
      const scope = axesOf.get(source)?.scope;
      if (scope === undefined || !isIsomorphicScope(scope)) continue;
      // `file` is package-relative, so the production tree is one prefix.
      if (!file.startsWith("src/")) continue;
      if (RUNTIME_ONLY_SPECIFIERS.test(specifier)) {
        violations.push(`${source} (scope:${scope}) -> ${specifier}  [${file}]`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("every declared dependency satisfies both axes of the matrix", () => {
    const violations: string[] = [];
    for (const edge of declaredEdges()) {
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
    const declared = new Set(declaredEdges().map(({ source, target }) => `${source} ${target}`));
    const missing = new Set<string>();
    for (const edge of importEdges()) {
      if (testMayImportTestKit(edge.file, edge.target)) continue;
      if (!declared.has(`${edge.source} ${edge.target}`)) {
        missing.add(`${edge.source} imports ${edge.target} without declaring it`);
      }
    }
    const list = [...missing].toSorted();
    expect(list, list.join("\n")).toEqual([]);
  });
});
