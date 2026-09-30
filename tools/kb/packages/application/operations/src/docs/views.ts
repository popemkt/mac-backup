import { Effect } from "effect";
import { KbCtx } from "@kb/contracts";
import {
  DOCS_VIEW_OPTION,
  SYSTEM_IDS,
  firstStr,
  viewOptionOf,
  type DocsViewSpec,
  type FailureCode,
  type KbNode,
} from "@kb/model";

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
 * A docs view: a view node naming `docs.markdown` (DESIGN.md → Kinds, roles
 * and options → View nodes), by the name it goes by — its text — and the
 * spec its params hold.
 */
export interface LoadedView {
  name: string;
  spec: DocsViewSpec;
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

/** The docs view a view node is, or the param it cannot be read without. */
function loadedView(node: KbNode): LoadedView | DocsError {
  const name = node.text.trim();
  const param = (field: string, label: string) => {
    const value = firstStr(field)(node.props);
    return value === undefined || value === ""
      ? new DocsError("invalid_input", `view ${name} has no ${label}`, { name, field })
      : value;
  };
  const template = param(SYSTEM_IDS.viewTemplateField, "template");
  if (template instanceof DocsError) return template;
  const output = param(SYSTEM_IDS.viewOutputField, "output");
  if (output instanceof DocsError) return output;
  if (!isRepoRelative(output))
    return new DocsError("invalid_input", `view ${name} is invalid`, {
      name,
      issues: ["output must be a repo-relative path without .."],
    });
  const optional = (field: string) => {
    const value = firstStr(field)(node.props);
    return value === "" ? undefined : value;
  };
  const query = optional(SYSTEM_IDS.lensQueryField);
  const savedQuery = optional(SYSTEM_IDS.viewSavedQueryField);
  if (query !== undefined && savedQuery === undefined)
    return { name, spec: { query, template, output } };
  if (savedQuery !== undefined && query === undefined)
    return { name, spec: { savedQuery, template, output } };
  return new DocsError(
    "invalid_input",
    `view ${name} needs exactly one of a query and a saved query`,
    { name },
  );
}

/**
 * The docs views, one by name or every one sorted by name: the view nodes
 * whose view is `docs.markdown`. A name two view nodes go by is ambiguous.
 */
export const loadViewsEffect = Effect.fn("docs.loadViews")(function* (
  name?: string,
): Effect.fn.Return<LoadedView[], DocsError, KbCtx> {
  const ctx = yield* KbCtx;
  const nodes = ctx.nodes
    .filter((node) => viewOptionOf(node) === DOCS_VIEW_OPTION)
    .filter((node) => name === undefined || node.text.trim() === name)
    .toSorted((a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id));
  if (name !== undefined && nodes.length === 0)
    return yield* Effect.fail(new DocsError("not_found", `view not found: ${name}`, { name }));
  if (name !== undefined && nodes.length > 1)
    return yield* Effect.fail(
      new DocsError("invalid_input", `view name is ambiguous: ${name}`, {
        name,
        ids: nodes.map((node) => node.id),
      }),
    );
  const views: LoadedView[] = [];
  for (const node of nodes) {
    const view = loadedView(node);
    if (view instanceof DocsError) return yield* Effect.fail(view);
    views.push(view);
  }
  return views;
});
