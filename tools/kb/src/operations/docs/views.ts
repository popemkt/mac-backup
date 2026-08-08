import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { z } from "zod";
import type { FailureCode } from "../../shared/contracts.ts";

/** Typed failure for docs operations; registry maps it to a receipt. */
export class DocsError extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DocsError";
  }
}

/**
 * View spec: `.kb/views/<name>.json`.
 * `output` is a repo-relative markdown path; exactly one of `query`
 * (inline EDN datalog) or `savedQuery` (name under `.kb/queries/`) drives
 * the rows fed to the named template.
 */
export const ViewSpecSchema = z
  .object({
    output: z.string().min(1),
    query: z.string().min(1).optional(),
    savedQuery: z.string().min(1).optional(),
    template: z.string().min(1),
  })
  .strict()
  .refine((v) => (v.query === undefined) !== (v.savedQuery === undefined), {
    message: "exactly one of query or savedQuery is required",
  })
  .refine(
    (v) =>
      !isAbsolute(v.output) &&
      !normalize(v.output).split(/[\\/]/).includes(".."),
    { message: "output must be a repo-relative path without .." },
  );

export type ViewSpec = z.infer<typeof ViewSpecSchema>;

export interface LoadedView {
  name: string;
  spec: ViewSpec;
}

export function viewsDir(root: string): string {
  return join(root, ".kb", "views");
}

async function loadView(root: string, name: string): Promise<LoadedView> {
  if (!/^[\w][\w.-]*$/.test(name)) {
    throw new DocsError("invalid_input", `invalid view name: ${name}`, {
      name,
    });
  }
  const path = join(viewsDir(root), `${name}.json`);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new DocsError("not_found", `view not found: ${name}`, { name, path });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new DocsError(
      "invalid_input",
      `view ${name} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { name, path },
    );
  }
  const result = ViewSpecSchema.safeParse(parsed);
  if (!result.success) {
    throw new DocsError("invalid_input", `view ${name} is invalid`, {
      name,
      path,
      issues: result.error.issues,
    });
  }
  return { name, spec: result.data };
}

/** Load one view by name, or all views sorted by name. */
export async function loadViews(
  root: string,
  name?: string,
): Promise<LoadedView[]> {
  if (name !== undefined) return [await loadView(root, name)];

  let entries: string[];
  try {
    entries = await readdir(viewsDir(root));
  } catch {
    return [];
  }
  const names = entries
    .filter((e) => e.endsWith(".json"))
    .map((e) => e.slice(0, -".json".length))
    .sort();
  return Promise.all(names.map((n) => loadView(root, n)));
}
