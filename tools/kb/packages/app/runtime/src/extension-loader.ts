import { Effect, Predicate, Result } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeContribution, isTemplateContribution } from "@kb/ext-sdk";
import {
  CodeTrust,
  type ExtensionAction,
  type ExtensionFailure,
  type ExtensionTemplate,
  type LoadedExtension,
} from "@kb/contracts";
import { extensionDigest } from "@kb/sandbox";

/**
 * Extension loader: discovers, imports and validates the TS modules in
 * `.kb/extensions/` against the extension contract. Each file becomes one
 * plugin (`extensionPlugin`), so its ids are namespaced `ext.<file>.<id>` by
 * the kernel like every other plugin's. Loader failures
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
 */
function extensionsDir(root: string): string {
  return join(root, ".kb", "extensions");
}

const NAME_RE = /^[\w][\w.-]*$/;

/**
 * The files among `files` a person has trusted here; each other one is a
 * failure that names its digest and the gesture that trusts it.
 */
const trustedFiles = Effect.fn("kb.trustedExtensions")(function* (
  dir: string,
  files: readonly string[],
  failures: ExtensionFailure[],
): Effect.fn.Return<string[], never, FileSystem | CodeTrust> {
  const fs = yield* FileSystem;
  const digests = new Map<string, string>();
  for (const file of files) {
    const source = yield* fs.readFileString(join(dir, file)).pipe(Effect.orElseSucceed(() => null));
    if (source === null) failures.push({ file, error: "could not be read" });
    else digests.set(file, yield* extensionDigest(source));
  }
  const trusted = new Set(
    yield* (yield* CodeTrust).trusted([...digests.values()]).pipe(Effect.orElseSucceed(() => [])),
  );
  return [...digests].flatMap(([file, digest]) => {
    if (trusted.has(digest)) return [file];
    failures.push({
      file,
      error: `not trusted on this machine (${digest}); trust it with sandbox.trust once you have read it`,
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
  // GAP [[01M541EP41BTAVD8TJXZGNNPRW]]: the file is imported from disk after its
  // digest is read, so a write between the two runs code nobody trusted.
  const files = yield* trustedFiles(extensionsDir(root), named, failures);
  for (const file of files) {
    const name = file.slice(0, -".ts".length);
    if (!NAME_RE.test(name)) {
      failures.push({ file, error: "extension file name must match /^[\\w][\\w.-]*$/" });
      continue;
    }
    const path = join(extensionsDir(root), file);
    const loaded = yield* Effect.tryPromise({
      try: () => import(pathToFileURL(path).href) as Promise<unknown>,
      catch: (err) => (err instanceof Error ? err.message : String(err)),
    }).pipe(
      Effect.map((mod) => ({ mod, error: null })),
      Effect.catch((error) => Effect.succeed({ mod: null, error })),
    );
    if (loaded.error !== null) {
      failures.push({ file, error: loaded.error });
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
    if (actions.length > 0 || templates.length > 0) {
      extensions.push({ name, source: path, actions, templates });
    }
  }
  return { extensions, failures };
});
