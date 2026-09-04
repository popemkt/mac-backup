import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isActionSchema } from "@kb/model";
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
 * Schemas accept Standard Schema v1 (`~standard`) or zod `.parse` (zod 4
 * implements both). Third-party extensions typically ship Promise handlers;
 * bundled extensions use Effect-native `effect`.
 */
function extensionsDir(root: string): string {
  return join(root, ".kb", "extensions");
}

export function namespacedId(extName: string, localId: string): string {
  return `ext.${extName}.${localId}`;
}

const NAME_RE = /^[\w][\w.-]*$/;

/** The one narrowing seam: unknown module exports viewed as a plain record. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function aliasesProblem(a: Record<string, unknown>, label: string): string | null {
  if (
    a.aliases !== undefined &&
    (!Array.isArray(a.aliases) || a.aliases.some((x) => typeof x !== "string"))
  ) {
    return `${label}: aliases must be a string array`;
  }
  return null;
}

function templateProblem(t: Record<string, unknown>): string | null {
  if (typeof t.id !== "string" || !NAME_RE.test(t.id)) {
    return "template id must match /^[\\w][\\w.-]*$/";
  }
  return aliasesProblem(t, `template ${t.id}`);
}

function actionProblem(a: Record<string, unknown>): string | null {
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
  return aliasesProblem(a, `action ${a.id}`);
}

/**
 * Discover and import `.kb/extensions/*.ts`. Per-file and per-contribution
 * failures are collected (and skipped); valid contributions load normally.
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
    const exported = asRecord(mod)?.default;
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
      const contribution = asRecord(candidate);
      if (contribution === null) {
        failures.push({ file, error: "contribution is not an object" });
        continue;
      }
      // A contribution carrying a `template` function is a render template.
      // The loader already discriminates structurally (`effect` vs
      // `handler`); this is the same distinction one level up.
      if (typeof contribution.template === "function") {
        const problem = templateProblem(contribution);
        if (problem !== null) {
          failures.push({ file, error: problem });
          continue;
        }
        templates.push(contribution as unknown as ExtensionTemplate);
        continue;
      }
      const problem = actionProblem(contribution);
      if (problem !== null) {
        failures.push({ file, error: problem });
        continue;
      }
      actions.push(contribution as unknown as ExtensionAction);
    }
    if (actions.length > 0 || templates.length > 0) {
      extensions.push({ name, source: path, actions, templates });
    }
  }
  return { extensions, failures };
}
