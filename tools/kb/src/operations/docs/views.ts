import { isAbsolute, join, normalize } from "node:path";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { z } from "zod";
import type { FailureCode } from "../../foundation/failure.ts";

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

function parseViewJson(name: string, path: string, raw: string): LoadedView {
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

const loadViewEffect = Effect.fn("docs.loadView")(
  function* (
    root: string,
    name: string,
  ): Effect.fn.Return<LoadedView, DocsError, FileSystem> {
    if (!/^[\w][\w.-]*$/.test(name)) {
      return yield* Effect.fail(
        new DocsError("invalid_input", `invalid view name: ${name}`, { name }),
      );
    }
    const path = join(viewsDir(root), `${name}.json`);
    const fs = yield* FileSystem;
    const raw = yield* fs.readFileString(path).pipe(
      Effect.mapError(
        () => new DocsError("not_found", `view not found: ${name}`, { name, path }),
      ),
    );
    return yield* Effect.try({
      try: () => parseViewJson(name, path, raw),
      catch: (err) =>
        err instanceof DocsError
          ? err
          : new DocsError(
              "internal",
              err instanceof Error ? err.message : String(err),
              { name, path },
            ),
    });
  },
);

/** Load one view by name, or all views sorted by name (Effect + FileSystem). */
export const loadViewsEffect = Effect.fn("docs.loadViews")(
  function* (
    root: string,
    name?: string,
  ): Effect.fn.Return<LoadedView[], DocsError, FileSystem> {
    if (name !== undefined) return [yield* loadViewEffect(root, name)];

    const fs = yield* FileSystem;
    const dir = viewsDir(root);
    const entries = yield* fs.readDirectory(dir).pipe(
      Effect.catch(() => Effect.succeed([] as string[])),
    );
    const names = entries
      .filter((e) => e.endsWith(".json"))
      .map((e) => e.slice(0, -".json".length))
      .sort();
    const views: LoadedView[] = [];
    for (const n of names) {
      views.push(yield* loadViewEffect(root, n));
    }
    return views;
  },
);
