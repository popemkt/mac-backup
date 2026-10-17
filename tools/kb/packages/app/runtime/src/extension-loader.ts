import { Effect, Predicate, Result } from "effect";
import { FileSystem } from "effect/FileSystem";
import { dirname, extname, join, sep } from "node:path";
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
 * Trust covers what it loads. An extension is its one file and the code
 * installed outside the root: each import it names, and each import of
 * what that loads at any depth, is resolved as Bun resolves it, and one
 * that reaches code the root carries, a helper or a package, however the
 * root configures resolution, refuses the file before anything is imported
 * (`rootCarriedImport`). An extension is a
 * file of its directory: a link to a file outside it is refused. What is
 * imported is the source whose digest was read, not the file as it is by
 * then (`importVerified`). What it loads or evaluates when it runs is what
 * the bytes a person read do (DESIGN.md → Sandbox → Trust).
 * GAP [[01M54NXDA4X8VZJ5DCZXX0PRHP]]
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
  readonly digest: string;
}

/**
 * The loader Bun reads a module with, by its file's extension: TypeScript,
 * or JavaScript with JSX, which is how Bun reads every JavaScript file, and
 * a file with none is read as JavaScript too. A file of another extension
 * (data, a stylesheet, a native addon) is not read as code, and imports
 * nothing.
 */
const LOADERS: Readonly<Record<string, "ts" | "tsx" | "jsx">> = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
  ".js": "jsx",
  ".mjs": "jsx",
  ".cjs": "jsx",
  ".jsx": "jsx",
  "": "jsx",
};
const transpilers = new Map<string, Bun.Transpiler>();

/**
 * What `source`, the module at `path`, imports as literals: none when Bun
 * does not read it as code, and null when it is code whose imports cannot
 * be read, which the closure then refuses rather than take for none.
 */
function literalImports(source: string, path: string): readonly string[] | null {
  const loader = LOADERS[extname(path)];
  if (loader === undefined) return [];
  let transpiler = transpilers.get(loader);
  if (transpiler === undefined) {
    transpiler = new Bun.Transpiler({ loader });
    transpilers.set(loader, transpiler);
  }
  try {
    return transpiler.scanImports(source).map(({ path: specifier }) => specifier);
  } catch {
    return null;
  }
}

/**
 * The file Bun resolves `specifier` to from `dir`, a built-in's name, or
 * null. Bun reads a `?` in a specifier as the start of a query, which it
 * carries onto what it resolves, and every other character as the path's
 * (`#` included); so the query the specifier carries comes off the end,
 * and nothing else is cut.
 */
function resolved(specifier: string, dir: string): string | null {
  let found: string;
  try {
    found = Bun.resolveSync(specifier, dir);
  } catch {
    return null;
  }
  const query = specifier.includes("?") ? specifier.slice(specifier.indexOf("?")) : "";
  return query !== "" && found.endsWith(query) ? found.slice(0, -query.length) : found;
}

/**
 * Why loading the extension at `path`, whose source is `source`, would load
 * code the root carries, or null. Each import it names as a literal (a
 * statement, a re-export, an `import()`, a `require`) is resolved as Bun
 * resolves it, path aliases and import maps the root configures included,
 * and so is each import of every file that resolves to, at any depth:
 * none may resolve into `within` (the root, and its extensions directory
 * when that is elsewhere), the approved file's bytes aside. The extension's
 * own imports must resolve; one a file outside the root names and Bun
 * cannot resolve loads nothing, as it would fail there too.
 */
const rootCarriedImport = Effect.fn("kb.rootCarriedImport")(function* (
  source: string,
  path: string,
  within: readonly string[],
): Effect.fn.Return<string | null, never, FileSystem> {
  const fs = yield* FileSystem;
  const seen = new Set([path]);
  const pending = [{ from: path, source }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { from } = next;
    const imports = literalImports(next.source, from);
    if (imports === null) {
      return `loads ${from}, whose imports cannot be read, so what it loads is not known`;
    }
    for (const specifier of imports) {
      const file = resolved(specifier, dirname(from));
      if (file === null) {
        if (from === path) return `imports ${specifier}, which does not resolve from it`;
        continue;
      }
      if (!file.startsWith(sep)) continue;
      const real = yield* fs.realPath(file).pipe(Effect.orElseSucceed(() => file));
      if (within.some((dir) => real.startsWith(`${dir}${sep}`))) {
        const through = from === path ? "" : `, through ${from}`;
        return `imports ${specifier} (${real})${through}, code the root carries that no person approved`;
      }
      if (seen.has(real)) continue;
      seen.add(real);
      const text = yield* fs.readFileString(real).pipe(Effect.orElseSucceed(() => ""));
      pending.push({ from: real, source: text });
    }
  }
  return null;
});

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
  const read = new Map<string, TrustedFile>();
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
  return [...read.values()].flatMap((file) => {
    const { digest } = file;
    if (trusted.has(digest)) return [file];
    failures.push({
      file: file.file,
      error:
        `not trusted on this machine (${digest}); trust it with sandbox.trust once you have read it: ` +
        "it runs with the server's reach, and so does what it loads or evaluates when it runs",
    });
    return [];
  });
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
  // The code the root carries: under it, and under its extensions directory if that is elsewhere.
  const within = realDir.startsWith(`${realRoot}${sep}`) ? [realRoot] : [realRoot, realDir];
  for (const { file, path, source, digest } of files) {
    const name = file.slice(0, -".ts".length);
    if (!NAME_RE.test(name)) {
      failures.push({ file, error: "extension file name must match /^[\\w][\\w.-]*$/" });
      continue;
    }
    const reaches = yield* rootCarriedImport(source, path, within);
    if (reaches !== null) {
      failures.push({ file, error: reaches });
      continue;
    }
    const loaded = yield* importVerified(path, source, digest).pipe(
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
