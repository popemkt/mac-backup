/**
 * The family axis and the composition-root fence (DESIGN.md → Extension
 * families → Enforcement), read off the tree. `constraints.ts` states the
 * rules and their tables; this module applies them to a packages root, so a
 * gate runs over the real workspace and a red fixture runs over a tree built
 * for one case through the same functions.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXTENSION_LAYER,
  EXTENSION_ROOTS,
  EXTENSION_ROOT_BREACHES,
  HOSTS_BY_SCOPE,
  type ExtensionRoot,
  type PackageAxes,
  type SanctionedExtensionImport,
  isPackageTestFile,
} from "./constraints.ts";
import {
  type AstNode,
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

type Roots = Readonly<Record<string, readonly ExtensionRoot[]>>;
type Sanctions = Readonly<Record<string, readonly SanctionedExtensionImport[]>>;

/** The layer whose packages are composition roots and delivery surfaces. */
const APP_LAYER = "app";

/** The function a family declares itself with (`@kb/contracts`). */
const DECLARE = "defineExtension";

/** The name a node spells, when it is an identifier or a string literal. */
function spelled(node: unknown): string | undefined {
  if (!isAstNode(node)) return undefined;
  if (node.type === "Identifier" && typeof node["name"] === "string") return node["name"];
  return stringLiteral(node);
}

/**
 * The literal `name` of one `defineExtension(...)` call's argument, or
 * `undefined` when it cannot be read without running the code: no object
 * literal, a spread, a computed key, or `name` given other than once as a
 * string literal.
 */
function literalName(args: unknown): string | undefined {
  const [first] = Array.isArray(args) ? args : [];
  const properties =
    isAstNode(first) && first.type === "ObjectExpression" ? first["properties"] : [];
  if (!Array.isArray(properties) || properties.length === 0) return undefined;
  const readable = properties.every(
    (property) =>
      isAstNode(property) && property.type === "Property" && property["computed"] !== true,
  );
  const names = properties.filter(
    (property) => isAstNode(property) && spelled(property["key"]) === "name",
  );
  const [name] = names;
  if (!readable || names.length !== 1 || !isAstNode(name)) return undefined;
  return stringLiteral(name["value"]);
}

/**
 * One entry per `defineExtension` reference in one file, in source order:
 * the literal name of a direct call `defineExtension({ name: "…" })`, and
 * `undefined` for anything else that names it — an aliased import, a member
 * call (`contracts.defineExtension`), a computed key, the function passed
 * around as a value. Only a direct literal call can be checked against a
 * tag without running the code, so every other form fails closed.
 */
export function declaredNames(file: string, source: string): Array<string | undefined> {
  const out: Array<string | undefined> = [];
  const read = new Set<AstNode>();
  walkAst(parseModule(file, source).program, (node) => {
    if (read.has(node)) return;
    if (node.type === "ImportSpecifier" && spelled(node["imported"]) === DECLARE) {
      // `import { defineExtension }` is how a direct call gets its callee; an alias is not.
      for (const part of [node["imported"], node["local"]]) if (isAstNode(part)) read.add(part);
      if (spelled(node["local"]) !== DECLARE) out.push(undefined);
      return;
    }
    const callee = node["callee"];
    if (
      node.type === "CallExpression" &&
      isAstNode(callee) &&
      callee.type === "Identifier" &&
      spelled(callee) === DECLARE
    ) {
      read.add(callee);
      out.push(literalName(node["arguments"]));
      return;
    }
    if (spelled(node) === DECLARE) out.push(undefined);
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
          `${declaration.at}: a ${DECLARE} reference that is not a direct call with a literal name, so family:${family} cannot be checked against it`,
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

/** The roots table entry for one file, if the file is a root. */
function rootOf(roots: Roots, edge: ImportEdge): ExtensionRoot | undefined {
  return roots[edge.source]?.find((root) => root.file === edge.file);
}

/** One import of an extension package by an `app` package from outside every root. */
export interface RootBreach extends ImportEdge {
  /** The sanctioned row that names its file, if one does. */
  readonly sanction: SanctionedExtensionImport | undefined;
}

/**
 * Every import an `app` package makes of an extension package from a file
 * that is not one of its roots, sanctioned ones included. Test files are
 * exempt.
 */
export function extensionRootBreaches(
  packagesRoot: string = PACKAGES_ROOT,
  roots: Roots = EXTENSION_ROOTS,
  sanctioned: Sanctions = EXTENSION_ROOT_BREACHES,
): RootBreach[] {
  const axes = packageAxes(workspacePackages(packagesRoot));
  const out: RootBreach[] = [];
  for (const edge of importEdges(packagesRoot)) {
    if (axes.get(edge.source)?.layer !== APP_LAYER) continue;
    if (axes.get(edge.target)?.layer !== EXTENSION_LAYER) continue;
    if (isPackageTestFile(edge.file) || rootOf(roots, edge) !== undefined) continue;
    const sanction = (sanctioned[edge.source] ?? []).find(
      (row) => row.target === edge.target && row.files.includes(edge.file),
    );
    out.push({ ...edge, sanction });
  }
  return out;
}

/**
 * Every sanctioned file that no longer imports its target: a sanction
 * outliving its breach reads as covered and is not. Checked per file, so
 * one live import cannot keep a whole row alive.
 */
export function staleRootSanctions(
  packagesRoot: string = PACKAGES_ROOT,
  roots: Roots = EXTENSION_ROOTS,
  sanctioned: Sanctions = EXTENSION_ROOT_BREACHES,
): string[] {
  const live = new Set(
    extensionRootBreaches(packagesRoot, roots, sanctioned).map(
      (breach) => `${breach.source} ${breach.file} -> ${breach.target}`,
    ),
  );
  return Object.entries(sanctioned)
    .flatMap(([source, rows]) =>
      rows.flatMap((row) => row.files.map((file) => `${source} ${file} -> ${row.target}`)),
    )
    .filter((site) => !live.has(site))
    .map((site) => `${site}: no such import any more`)
    .toSorted();
}

/**
 * Every re-export of an extension package from a root: `export … from` an
 * extension package, or `export { x }` of a binding imported from one —
 * the module record lists the second as an indirect export from the same
 * request, so both are one test. Either would let any file reach the
 * feature through the root.
 */
export function rootReExports(
  packagesRoot: string = PACKAGES_ROOT,
  roots: Roots = EXTENSION_ROOTS,
): string[] {
  const packages = workspacePackages(packagesRoot);
  const extensions = new Set(
    packages.filter((pkg) => pkg.layer === EXTENSION_LAYER).map((pkg) => pkg.name),
  );
  const isExtension = (specifier: string): boolean =>
    extensions.has(/^@kb\/[a-z0-9-]+/.exec(specifier)?.[0] ?? "");
  const out: string[] = [];
  for (const { name, dir } of packages) {
    for (const { file } of roots[name] ?? []) {
      const path = join(packagesRoot, dir, file);
      if (!existsSync(path)) continue;
      const { module } = parseModule(path, readFileSync(path, "utf8"));
      for (const entry of module.staticExports.flatMap((statement) => statement.entries)) {
        const from = entry.moduleRequest?.value;
        if (from !== undefined && isExtension(from)) out.push(`${name} ${file} re-exports ${from}`);
      }
    }
  }
  return out.toSorted();
}

/**
 * Every extension package that no host loads, counting only imports that
 * load a value — a type-only import loads nothing — and none from test
 * files. A package of a scope that runs in a host is loaded by a root of
 * that host. A `scope:shared` package is loaded by a root of a host, or by a
 * loaded package of its own family.
 */
export function unpairedExtensions(
  packagesRoot: string = PACKAGES_ROOT,
  roots: Roots = EXTENSION_ROOTS,
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
      if (hosts.length === 0 && !loads.loaded.has(name)) {
        unloaded.push(
          `${name} (scope:${scope}): no root and no loaded package of family:${family ?? "none"} loads it`,
        );
      }
      return unloaded;
    })
    .toSorted();
}

/**
 * What the production value imports load: `byHost` holds `<host> <package>`
 * for each package a root of that host imports, and `loaded` every package
 * so imported, closed over the imports a loaded extension package makes of
 * its own family.
 */
function loadsOf(
  packagesRoot: string,
  roots: Roots,
  axes: ReadonlyMap<string, PackageAxes>,
): { readonly byHost: ReadonlySet<string>; readonly loaded: ReadonlySet<string> } {
  const byHost = new Set<string>();
  const loaded = new Set<string>();
  const siblings: ImportEdge[] = [];
  for (const edge of importEdges(packagesRoot)) {
    if (edge.kind === "type" || isPackageTestFile(edge.file)) continue;
    const hosts = rootOf(roots, edge)?.hosts ?? [];
    for (const host of hosts) byHost.add(`${host} ${edge.target}`);
    if (hosts.length > 0) loaded.add(edge.target);
    if (sameFamily(axes, edge.source, edge.target)) siblings.push(edge);
  }
  for (let grew = true; grew;) {
    const before = loaded.size;
    for (const edge of siblings) if (loaded.has(edge.source)) loaded.add(edge.target);
    grew = loaded.size > before;
  }
  return { byHost, loaded };
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
