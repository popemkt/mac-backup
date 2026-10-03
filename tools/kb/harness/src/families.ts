/**
 * The family axis and the composition-root fence (DESIGN.md → Extension
 * families → Enforcement), read off the tree. `constraints.ts` states the
 * rules and their tables; this module applies them to a packages root, so a
 * gate runs over the real workspace and a red fixture runs over a tree built
 * for one case through the same functions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXTENSION_LAYER,
  EXTENSION_ROOTS,
  EXTENSION_ROOT_BREACHES,
  HOSTS_BY_SCOPE,
  type PackageAxes,
  type ExtensionRoot,
  type SanctionedExtensionImport,
  isPackageTestFile,
} from "./constraints.ts";
import {
  type ImportEdge,
  importEdges,
  isAstNode,
  parseModule,
  sourceFilesUnder,
  stringLiteral,
  walkAst,
} from "./import-graph.ts";
import {
  PACKAGES_ROOT,
  type WorkspacePackage,
  axisValues,
  packageAxes,
  tagsOf,
  workspacePackages,
} from "./workspace.ts";

/** The layer whose packages are composition roots and delivery surfaces. */
const APP_LAYER = "app";

/** The function a family declares itself with (`@kb/contracts`). */
const DECLARE = "defineExtension";

/**
 * The `name` of every `defineExtension({ name })` call in one file, in
 * source order: the string when it is a literal, `undefined` when it is
 * not. Only a literal can be checked against a tag without running the
 * code, so anything else is a failure, not a pass.
 */
export function declaredNames(file: string, source: string): Array<string | undefined> {
  const out: Array<string | undefined> = [];
  walkAst(parseModule(file, source).program, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = node["callee"];
    if (!isAstNode(callee) || callee["name"] !== DECLARE) return;
    const [first] = Array.isArray(node["arguments"]) ? node["arguments"] : [];
    const properties = isAstNode(first) ? first["properties"] : undefined;
    const name = Array.isArray(properties)
      ? properties.find((property) => {
          const key = isAstNode(property) ? property["key"] : undefined;
          return isAstNode(key) && (key["name"] === "name" || key["value"] === "name");
        })
      : undefined;
    out.push(stringLiteral(isAstNode(name) ? name["value"] : undefined));
  });
  return out;
}

/** One declaration, where it sits. */
interface Declaration {
  readonly at: string;
  readonly name: string | undefined;
}

/** Every declaration in one package's production sources. */
function declarationsOf(pkg: WorkspacePackage, packagesRoot: string): Declaration[] {
  const root = join(packagesRoot, pkg.dir);
  const out: Declaration[] = [];
  for (const file of sourceFilesUnder(root)) {
    const rel = file.slice(root.length + 1);
    if (!rel.startsWith("src/") || isPackageTestFile(rel)) continue;
    for (const name of declaredNames(file, readFileSync(file, "utf8"))) {
      out.push({ at: `${pkg.dir}/${rel}`, name });
    }
  }
  return out;
}

/**
 * Every way the family tags and the declarations fail to agree:
 *
 * - an extension package carries exactly one `family:` tag, and no other
 *   package carries one;
 * - each family declares itself exactly once, with a literal name, and that
 *   name is the tag every package of the family carries.
 */
export function familyProblems(packagesRoot: string = PACKAGES_ROOT): string[] {
  const problems: string[] = [];
  const declarations = new Map<string, Declaration[]>();
  for (const pkg of workspacePackages(packagesRoot)) {
    const families = axisValues(tagsOf(pkg.manifest), "family");
    if (pkg.layer !== EXTENSION_LAYER) {
      if (families.length > 0) {
        problems.push(
          `${pkg.dir}: family tags ${JSON.stringify(families)} outside the extension layer`,
        );
      }
      continue;
    }
    const [family] = families;
    if (families.length !== 1 || family === undefined) {
      problems.push(
        `${pkg.dir}: family tags ${JSON.stringify(families)}; an extension package carries exactly one`,
      );
      continue;
    }
    const own = declarations.get(family) ?? [];
    declarations.set(family, own);
    for (const declaration of declarationsOf(pkg, packagesRoot)) {
      own.push(declaration);
      if (declaration.name === undefined) {
        problems.push(
          `${declaration.at}: ${DECLARE}'s name is not a string literal, so family:${family} cannot be checked against it`,
        );
      } else if (declaration.name !== family) {
        problems.push(
          `${declaration.at}: declares "${declaration.name}", but its package is tagged family:${family}`,
        );
      }
    }
  }
  for (const [family, found] of declarations) {
    if (found.length === 0) {
      problems.push(
        `family:${family}: no package of the family calls ${DECLARE}, so its name has no home`,
      );
    } else if (found.length > 1) {
      problems.push(
        `family:${family}: declared ${found.length} times (${found.map((d) => d.at).join(", ")})`,
      );
    }
  }
  return problems.toSorted();
}

function covers(path: string, file: string): boolean {
  return path.endsWith("/") ? file.startsWith(path) : file === path;
}

/** The roots table entry for one file, if the file is a root. */
function rootOf(
  roots: Readonly<Record<string, readonly ExtensionRoot[]>>,
  edge: ImportEdge,
): ExtensionRoot | undefined {
  return roots[edge.source]?.find((root) => root.file === edge.file);
}

/** One import of an extension package by an `app` package from outside every root. */
export interface RootBreach extends ImportEdge {
  /** The sanctioned row that covers it, if one does. */
  readonly sanction: SanctionedExtensionImport | undefined;
}

/**
 * Every import an `app` package makes of an extension package from a file
 * that is not one of its roots, sanctioned ones included. Test files are
 * exempt.
 */
export function extensionRootBreaches(
  packagesRoot: string = PACKAGES_ROOT,
  roots: Readonly<Record<string, readonly ExtensionRoot[]>> = EXTENSION_ROOTS,
  sanctioned: Readonly<
    Record<string, readonly SanctionedExtensionImport[]>
  > = EXTENSION_ROOT_BREACHES,
): RootBreach[] {
  const axes = packageAxes(workspacePackages(packagesRoot));
  const out: RootBreach[] = [];
  for (const edge of importEdges(packagesRoot)) {
    if (axes.get(edge.source)?.layer !== APP_LAYER) continue;
    if (axes.get(edge.target)?.layer !== EXTENSION_LAYER) continue;
    if (isPackageTestFile(edge.file) || rootOf(roots, edge) !== undefined) continue;
    const sanction = (sanctioned[edge.source] ?? []).find(
      (row) => row.target === edge.target && covers(row.path, edge.file),
    );
    out.push({ ...edge, sanction });
  }
  return out;
}

/** Sanctioned rows that no breach matches any more: a sanction outliving its breach reads as covered and is not. */
export function staleRootSanctions(
  packagesRoot: string = PACKAGES_ROOT,
  roots: Readonly<Record<string, readonly ExtensionRoot[]>> = EXTENSION_ROOTS,
  sanctioned: Readonly<
    Record<string, readonly SanctionedExtensionImport[]>
  > = EXTENSION_ROOT_BREACHES,
): string[] {
  const used = new Set(
    extensionRootBreaches(packagesRoot, roots, sanctioned).flatMap((breach) =>
      breach.sanction === undefined ? [] : [breach.sanction],
    ),
  );
  return Object.entries(sanctioned)
    .flatMap(([source, rows]) =>
      rows
        .filter((row) => !used.has(row))
        .map((row) => `${source} ${row.path} -> ${row.target}: no such import any more`),
    )
    .toSorted();
}

/**
 * Every extension package that no host loads: a package of a scope that
 * runs in a host is imported by a root of that host, and a `scope:shared`
 * package by some root or by a package of its own family. Imports from test
 * files load nothing and do not count.
 */
export function unpairedExtensions(
  packagesRoot: string = PACKAGES_ROOT,
  roots: Readonly<Record<string, readonly ExtensionRoot[]>> = EXTENSION_ROOTS,
): string[] {
  const packages = workspacePackages(packagesRoot);
  const axes = packageAxes(packages);
  const loads = loadsOf(packagesRoot, roots, axes);
  return packages
    .filter((pkg) => pkg.layer === EXTENSION_LAYER)
    .flatMap(({ name }) => {
      const { scope, family } = axes.get(name) ?? { scope: undefined, family: undefined };
      const hosts = HOSTS_BY_SCOPE[scope ?? ""] ?? [];
      const unloaded = hosts
        .filter((host) => !loads.byHost.has(`${host} ${name}`))
        .map((host) => `${name} (scope:${scope}): no ${host} root loads it`);
      if (hosts.length === 0 && !loads.reached.has(name)) {
        unloaded.push(
          `${name} (scope:${scope}): no root and no package of family:${family ?? "none"} loads it`,
        );
      }
      return unloaded;
    })
    .toSorted();
}

/**
 * What the production imports load: `byHost` holds `<host> <package>` for
 * each package a root of that host imports, and `reached` every package a
 * root or a package of its own family imports.
 */
function loadsOf(
  packagesRoot: string,
  roots: Readonly<Record<string, readonly ExtensionRoot[]>>,
  axes: ReadonlyMap<string, PackageAxes>,
): { readonly byHost: ReadonlySet<string>; readonly reached: ReadonlySet<string> } {
  const byHost = new Set<string>();
  const reached = new Set<string>();
  for (const edge of importEdges(packagesRoot)) {
    if (isPackageTestFile(edge.file)) continue;
    const root = rootOf(roots, edge);
    for (const host of root?.hosts ?? []) byHost.add(`${host} ${edge.target}`);
    if (root !== undefined || sameFamily(axes, edge.source, edge.target)) reached.add(edge.target);
  }
  return { byHost, reached };
}

/** Two extension packages of one family. */
function sameFamily(axes: ReadonlyMap<string, PackageAxes>, a: string, b: string): boolean {
  const left = axes.get(a);
  const right = axes.get(b);
  return (
    left?.layer === EXTENSION_LAYER &&
    right?.layer === EXTENSION_LAYER &&
    left.family !== undefined &&
    left.family === right.family
  );
}
