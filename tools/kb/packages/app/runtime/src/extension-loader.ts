import { Effect, Predicate, Result } from "effect";
import { FileSystem } from "effect/FileSystem";
import { dirname, join, sep } from "node:path";
import { decodeContribution, decodeDeclaration, isTemplateContribution } from "@kb/ext-sdk";
import {
  CodeTrust,
  type ExtensionAction,
  type ExtensionFailure,
  type ExtensionTemplate,
  type LoadedExtension,
} from "@kb/contracts";
import { extensionDigest } from "@kb/sandbox";
import { importVerified } from "./verified-import.ts";

/**
 * Extension loader: discovers, imports and validates the TS modules in
 * `.kb/extensions/` against the extension contract. Each file becomes one
 * plugin (`extensionPlugin`), so its ids are namespaced `ext.<file>.<id>` by
 * the kernel like every other plugin's, and carries its declaration
 * (`decodeDeclaration`), so it is a family like a bundled one. Loader failures
 * warn and skip the offending file/contribution; they never crash core.
 *
 * What a contribution must look like is @kb/ext-sdk's contract, decoded by
 * `decodeContribution` — this file's job is discovery and the per-file error
 * report, not a second copy of the shape.
 *
 * A repository extension runs with the server's reach, so a file is imported
 * only once a person has trusted it on this machine: its digest
 * (`extensionDigest`, the file's source) is in the root's code trust
 * (`CodeTrust`, the record sandboxed code is trusted in, and `sandbox.trust`
 * the gesture). An untrusted file is skipped with its digest, so whoever
 * opens a root someone else wrote — a location opened for an agent, a clone
 * — runs none of its code until they have looked at it.
 *
 * Trust covers what runs. An extension is its one file and the packages
 * installed outside the root, and it names what it imports: an import of
 * another file (`./helper.ts`, `../src/x.ts`), of a package the root itself
 * carries, or of anything only known when it runs (a computed `import()`, a
 * `require` it does not call with a literal) is code the digest does not
 * cover, so the file is refused before anything is imported
 * (`unverifiedImport`). An extension is a file of its directory: a link to
 * a file outside it is refused. What is imported is the source whose digest
 * was read, not the file as it is by then (`importVerified`), and any other
 * file of the directory, however it is reached, never runs.
 */
function extensionsDir(root: string): string {
  return join(root, ".kb", "extensions");
}

const NAME_RE = /^[\w][\w.-]*$/;

/** A trusted file: its name, its real path, and the source whose digest was trusted. */
interface TrustedFile {
  readonly file: string;
  readonly path: string;
  readonly source: string;
}

const transpiler = new Bun.Transpiler({ loader: "ts" });

/** Whether an import specifier names a file rather than a package. */
function namesFile(specifier: string): boolean {
  return /^(\.{1,2}(\/|$)|\/|file:)/.test(specifier);
}

/** The package a bare specifier names (`@scope/name`, `name`), or null for a built-in. */
function packageOf(specifier: string): string | null {
  if (/^(node|bun):/.test(specifier)) return null;
  const [first = "", second = ""] = specifier.split("/");
  return first.startsWith("@") ? `${first}/${second}` : first;
}

/** Imports and `require`s in `source` whose specifier is not a literal. */
function computedImports(source: string): number {
  const literal = transpiler
    .scanImports(source)
    .filter(({ kind }) => kind === "dynamic-import" || kind === "require-call").length;
  const js = transpiler.transformSync(source);
  const written =
    (js.match(/\bimport\s*\(/g) ?? []).length + (js.match(/\brequire\b/g) ?? []).length;
  return written - literal;
}

/**
 * Why `source` imports code its digest does not cover, or null: anything it
 * names only when it runs, another file, or a package the root carries in a
 * `node_modules` of its own between the extension and the root (`carrier`:
 * where, if it does), whether that is a directory or a link to one
 * elsewhere.
 */
function unverifiedImport(
  source: string,
  carrier: (pkg: string) => string | undefined,
): string | null {
  if (computedImports(source) > 0)
    return "imports what is only known when it runs; an extension names every import as a literal";
  for (const { path: specifier } of transpiler.scanImports(source)) {
    if (namesFile(specifier))
      return `imports ${specifier}; an extension is one file, and only that file is trusted`;
    const pkg = packageOf(specifier);
    const carried = pkg === null ? undefined : carrier(pkg);
    if (carried !== undefined)
      return `imports ${specifier}, which the root carries (${carried}), and its trust does not cover`;
  }
  return null;
}

/**
 * The files among `files` a person has trusted here, each with the source
 * that was trusted; each other one is a failure that names its digest and
 * the gesture that trusts it.
 */
const trustedFiles = Effect.fn("kb.trustedExtensions")(function* (
  dir: string,
  realDir: string,
  files: readonly string[],
  failures: ExtensionFailure[],
): Effect.fn.Return<TrustedFile[], never, FileSystem | CodeTrust> {
  const fs = yield* FileSystem;
  const read = new Map<string, TrustedFile & { readonly digest: string }>();
  for (const file of files) {
    const path = yield* fs.realPath(join(dir, file)).pipe(Effect.orElseSucceed(() => null));
    if (path !== null && !path.startsWith(`${realDir}${sep}`)) {
      failures.push({
        file,
        error: `links out of .kb/extensions (to ${path}); an extension is a file of its directory`,
      });
      continue;
    }
    const source =
      path === null ? null : yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => null));
    if (path === null || source === null) failures.push({ file, error: "could not be read" });
    else read.set(file, { file, path, source, digest: yield* extensionDigest(source) });
  }
  const trusted = new Set(
    yield* (yield* CodeTrust)
      .trusted([...read.values()].map(({ digest }) => digest))
      .pipe(Effect.orElseSucceed(() => [])),
  );
  return [...read.values()].flatMap(({ digest, ...file }) => {
    if (trusted.has(digest)) return [file];
    failures.push({
      file: file.file,
      error: `not trusted on this machine (${digest}); trust it with sandbox.trust once you have read it`,
    });
    return [];
  });
});

/** Each package the `node_modules` directories `among` hold, by name, with where it is. */
const carriedPackages = Effect.fn("kb.carriedPackages")(function* (
  among: readonly string[],
): Effect.fn.Return<ReadonlyMap<string, string>, never, FileSystem> {
  const fs = yield* FileSystem;
  const list = (dir: string) => fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
  const carried = new Map<string, string>();
  for (const modules of among) {
    for (const entry of yield* list(modules)) {
      if (!entry.startsWith("@")) carried.set(entry, modules);
      else
        for (const scoped of yield* list(join(modules, entry)))
          carried.set(`${entry}/${scoped}`, modules);
    }
  }
  return carried;
});

/**
 * Discover and import the trusted `.kb/extensions/*.ts`. Per-file and
 * per-contribution failures, untrusted files among them, are collected (and
 * skipped); valid contributions load normally.
 */
export const discoverExtensions = Effect.fn("kb.discoverExtensions")(function* (
  root: string,
): Effect.fn.Return<
  { extensions: LoadedExtension[]; failures: ExtensionFailure[] },
  never,
  FileSystem | CodeTrust
> {
  const fs = yield* FileSystem;
  const entries = yield* fs
    .readDirectory(extensionsDir(root))
    .pipe(Effect.orElseSucceed(() => null));
  if (entries === null) return { extensions: [], failures: [] };
  const named = entries.filter((e) => e.endsWith(".ts") && !e.endsWith(".d.ts")).toSorted();

  const extensions: LoadedExtension[] = [];
  const failures: ExtensionFailure[] = [];
  const dir = extensionsDir(root);
  const realRoot = yield* fs.realPath(root).pipe(Effect.orElseSucceed(() => root));
  const realDir = yield* fs.realPath(dir).pipe(Effect.orElseSucceed(() => dir));
  const files = yield* trustedFiles(dir, realDir, named, failures);
  // The `node_modules` an extension's packages would resolve through, up to the root.
  const carried = yield* carriedPackages(
    [realDir, dirname(realDir), realRoot].map((at) => join(at, "node_modules")),
  );
  for (const { file, path, source } of files) {
    const name = file.slice(0, -".ts".length);
    if (!NAME_RE.test(name)) {
      failures.push({ file, error: "extension file name must match /^[\\w][\\w.-]*$/" });
      continue;
    }
    const reaches = unverifiedImport(source, (pkg) => carried.get(pkg));
    if (reaches !== null) {
      failures.push({ file, error: reaches });
      continue;
    }
    const loaded = yield* importVerified(realDir, path, source).pipe(
      Effect.map((mod) => ({ mod, error: null })),
      Effect.catch((error) => Effect.succeed({ mod: null, error })),
    );
    if (loaded.error !== null) {
      failures.push({ file, error: loaded.error });
      continue;
    }
    const declared = decodeDeclaration(
      Predicate.isObject(loaded.mod) ? loaded.mod.declaration : undefined,
      name,
    );
    if (Result.isFailure(declared)) {
      failures.push({ file, error: declared.failure });
      continue;
    }
    const exported = Predicate.isObject(loaded.mod) ? loaded.mod.default : undefined;
    if (!Array.isArray(exported)) {
      failures.push({
        file,
        error:
          "default export must be an array of contributions " +
          "({...ActionDefinition, effect|handler} or {id, template})",
      });
      continue;
    }
    const actions: ExtensionAction[] = [];
    const templates: ExtensionTemplate[] = [];
    for (const candidate of exported) {
      const decoded = decodeContribution(candidate);
      if (Result.isFailure(decoded)) {
        failures.push({ file, error: decoded.failure });
        continue;
      }
      const contribution = decoded.success;
      if (isTemplateContribution(contribution)) templates.push(contribution);
      else actions.push(contribution);
    }
    // A module that declares itself is an extension even with nothing to
    // contribute yet: its node and its settings are data.
    const declares = Predicate.isObject(loaded.mod) && loaded.mod.declaration !== undefined;
    if (actions.length > 0 || templates.length > 0 || declares) {
      extensions.push({ name, source: path, declaration: declared.success, actions, templates });
    }
  }
  return { extensions, failures };
});
