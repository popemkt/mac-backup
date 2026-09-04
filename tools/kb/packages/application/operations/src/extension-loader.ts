import { Effect, Predicate, Result } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeContribution, isTemplateContribution } from "@kb/ext-sdk";
import type {
  ExtensionAction,
  ExtensionFailure,
  ExtensionTemplate,
  LoadedExtension,
} from "@kb/contracts";

/**
 * Extension loader: discovers, imports and validates the TS modules in
 * `.kb/extensions/` against the extension contract. The registry namespaces
 * every contributed id as `ext.<file>.<id>` at build time. Loader failures
 * warn and skip the offending file/contribution; they never crash core.
 *
 * What a contribution must look like is @kb/ext-sdk's contract, decoded by
 * `decodeContribution` — this file's job is discovery and the per-file error
 * report, not a second copy of the shape.
 */
function extensionsDir(root: string): string {
  return join(root, ".kb", "extensions");
}

export function namespacedId(extName: string, localId: string): string {
  return `ext.${extName}.${localId}`;
}

const NAME_RE = /^[\w][\w.-]*$/;

/**
 * Discover and import `.kb/extensions/*.ts`. Per-file and per-contribution
 * failures are collected (and skipped); valid contributions load normally.
 */
export const discoverExtensions = Effect.fn("kb.discoverExtensions")(function* (
  root: string,
): Effect.fn.Return<
  { extensions: LoadedExtension[]; failures: ExtensionFailure[] },
  never,
  FileSystem
> {
  const fs = yield* FileSystem;
  const entries = yield* fs
    .readDirectory(extensionsDir(root))
    .pipe(Effect.orElseSucceed(() => null));
  if (entries === null) return { extensions: [], failures: [] };
  const files = entries.filter((e) => e.endsWith(".ts") && !e.endsWith(".d.ts")).toSorted();

  const extensions: LoadedExtension[] = [];
  const failures: ExtensionFailure[] = [];
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
