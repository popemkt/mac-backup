import { Effect } from "effect";
import { z } from "zod";
import { Views, isValidWorkspaceName } from "@kb/contracts";
import type { FailureCode } from "@kb/model";

/** Typed failure for docs operations; registry maps it to a receipt. */
export class DocsError extends Error {
  readonly code: FailureCode;
  readonly details?: unknown;

  constructor(code: FailureCode, message: string, details?: unknown) {
    super(message);
    this.name = "DocsError";
    this.code = code;
    this.details = details;
  }
}

/**
 * View spec: `.kb/views/<name>.json`.
 * `output` is a repo-relative markdown path; exactly one of `query`
 * (inline EDN datalog) or `savedQuery` (name under `.kb/queries/`) drives
 * the rows fed to the named template.
 */
const ViewSpecSchema = z
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
  .refine((v) => isRepoRelative(v.output), {
    message: "output must be a repo-relative path without ..",
  });

type ViewSpec = z.infer<typeof ViewSpecSchema>;

export interface LoadedView {
  name: string;
  spec: ViewSpec;
}

/**
 * A view writes its markdown somewhere in the repo, so the one thing its
 * `output` may not do is leave it. Pure on purpose — a path this rejects is
 * rejected the same way in every runtime, and the port that owns real paths
 * never sees it.
 */
function isRepoRelative(output: string): boolean {
  if (/^([/\\]|[a-zA-Z]:[/\\])/.test(output)) return false;
  return !output.split(/[\\/]/).includes("..");
}

function parseViewJson(name: string, raw: string): LoadedView {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new DocsError(
      "invalid_input",
      `view ${name} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { name },
    );
  }
  const result = ViewSpecSchema.safeParse(parsed);
  if (!result.success) {
    throw new DocsError("invalid_input", `view ${name} is invalid`, {
      name,
      issues: result.error.issues,
    });
  }
  return { name, spec: result.data };
}

const loadViewEffect = Effect.fn("docs.loadView")(function* (
  name: string,
): Effect.fn.Return<LoadedView, DocsError, Views> {
  if (!isValidWorkspaceName(name)) {
    return yield* Effect.fail(
      new DocsError("invalid_input", `invalid view name: ${name}`, { name }),
    );
  }
  const views = yield* Views;
  const raw = yield* views
    .load(name)
    .pipe(Effect.mapError((err) => new DocsError("internal", err.message, { name })));
  if (raw === null) {
    return yield* Effect.fail(new DocsError("not_found", `view not found: ${name}`, { name }));
  }
  return yield* Effect.try({
    try: () => parseViewJson(name, raw),
    catch: (err) =>
      err instanceof DocsError
        ? err
        : new DocsError("internal", err instanceof Error ? err.message : String(err), { name }),
  });
});

/** Load one view by name, or every view sorted by name. */
export const loadViewsEffect = Effect.fn("docs.loadViews")(function* (
  name?: string,
): Effect.fn.Return<LoadedView[], DocsError, Views> {
  if (name !== undefined) return [yield* loadViewEffect(name)];

  const port = yield* Views;
  const names = yield* port.list.pipe(
    Effect.mapError((err) => new DocsError("internal", err.message)),
  );
  const views: LoadedView[] = [];
  for (const n of names) {
    views.push(yield* loadViewEffect(n));
  }
  return views;
});
