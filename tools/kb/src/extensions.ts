import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ActionDefinition,
  ActionEffectHandler,
} from "./shared/contracts.ts";
import type { KbContext } from "./context.ts";
import { isActionSchema } from "./foundation/schema-seam.ts";

/**
 * Extension seam: a TS module in `.kb/extensions/` (repo-local = trusted)
 * default-exports an array of harman-style actions — an `ActionDefinition`
 * plus either an Effect `effect` handler (preferred) or a legacy Promise
 * `handler`. The registry namespaces each action id as
 * `ext.<file>.<action>` at build time. Loader failures warn and skip the
 * offending file/action; they never crash core.
 *
 * Schemas accept Standard Schema v1 (`~standard`) or zod `.parse` (zod 4
 * implements both). Third-party extensions typically ship Promise handlers;
 * bundled extensions use Effect-native `effect`.
 */
export type ExtensionPromiseHandler = (
  ctx: KbContext,
  input: never,
) => Promise<unknown>;

export type ExtensionAction = ActionDefinition & {
  /** Extra top-level ids this action also answers to (compat shims). */
  aliases?: readonly string[];
} & (
  | {
      effect: ActionEffectHandler;
      handler?: ExtensionPromiseHandler;
    }
  | {
      handler: ExtensionPromiseHandler;
      effect?: ActionEffectHandler;
    }
);

export interface LoadedExtension {
  /** File basename without `.ts`; becomes the `ext.<name>.` namespace. */
  name: string;
  /** "bundled" or the absolute path of the source module. */
  source: string;
  /** Actions as authored (ids still local, un-namespaced). */
  actions: readonly ExtensionAction[];
}

export interface ExtensionFailure {
  file: string;
  error: string;
}

export function extensionsDir(root: string): string {
  return join(root, ".kb", "extensions");
}

export function namespacedId(extName: string, actionId: string): string {
  return `ext.${extName}.${actionId}`;
}

const NAME_RE = /^[\w][\w.-]*$/;

function actionProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return "action is not an object";
  }
  const a = value as Record<string, unknown>;
  if (typeof a.id !== "string" || !NAME_RE.test(a.id)) {
    return "action id must match /^[\\w][\\w.-]*$/";
  }
  for (const key of ["title", "description"] as const) {
    if (typeof a[key] !== "string") return `action ${a.id}: ${key} must be a string`;
  }
  if (a.mode !== "read" && a.mode !== "apply") {
    return `action ${a.id}: mode must be "read" or "apply"`;
  }
  for (const key of ["inputSchema", "outputSchema"] as const) {
    if (!isActionSchema(a[key])) {
      return `action ${a.id}: ${key} must be a Standard Schema v1 or zod schema`;
    }
  }
  const hasEffect = typeof a.effect === "function";
  const hasHandler = typeof a.handler === "function";
  if (!hasEffect && !hasHandler) {
    return `action ${a.id}: effect or handler must be a function`;
  }
  if (
    a.aliases !== undefined &&
    (!Array.isArray(a.aliases) || a.aliases.some((x) => typeof x !== "string"))
  ) {
    return `action ${a.id}: aliases must be a string array`;
  }
  return null;
}

/**
 * Discover and import `.kb/extensions/*.ts`. Per-file and per-action
 * failures are collected (and skipped), valid actions load normally.
 */
export async function discoverExtensions(root: string): Promise<{
  extensions: LoadedExtension[];
  failures: ExtensionFailure[];
}> {
  let entries: string[];
  try {
    entries = await readdir(extensionsDir(root));
  } catch {
    return { extensions: [], failures: [] };
  }
  const files = entries
    .filter((e) => e.endsWith(".ts") && !e.endsWith(".d.ts"))
    .sort();

  const extensions: LoadedExtension[] = [];
  const failures: ExtensionFailure[] = [];
  for (const file of files) {
    const name = file.slice(0, -".ts".length);
    if (!NAME_RE.test(name)) {
      failures.push({ file, error: "extension file name must match /^[\\w][\\w.-]*$/" });
      continue;
    }
    const path = join(extensionsDir(root), file);
    let mod: unknown;
    try {
      mod = await import(pathToFileURL(path).href);
    } catch (err) {
      failures.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const exported = (mod as { default?: unknown }).default;
    if (!Array.isArray(exported)) {
      failures.push({
        file,
        error:
          "default export must be an array of actions ({...ActionDefinition, effect|handler})",
      });
      continue;
    }
    const actions: ExtensionAction[] = [];
    for (const candidate of exported) {
      const problem = actionProblem(candidate);
      if (problem) {
        failures.push({ file, error: problem });
        continue;
      }
      actions.push(candidate as ExtensionAction);
    }
    if (actions.length > 0) {
      extensions.push({ name, source: path, actions });
    }
  }
  return { extensions, failures };
}
