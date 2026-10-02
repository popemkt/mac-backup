import { Effect } from "effect";
import { KbCtx } from "@kb/contracts";
import {
  SYSTEM_IDS,
  docsViewNameError,
  docsViewNameOf,
  firstStr,
  isDocsView,
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
  const name = docsViewNameOf(node);
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
 * Every docs view node — a view node whose view is `docs.markdown` — sorted
 * by name, as the view it is or, by the name it goes by, why it cannot be
 * one: its name is no workspace name or another docs view goes by it too
 * (`docsViewNameError`), or a param it cannot be read without is missing.
 */
function readDocsViews(nodes: readonly KbNode[]): {
  views: LoadedView[];
  failures: Map<string, DocsError>;
} {
  const docs = nodes
    .filter(isDocsView)
    .toSorted((a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id));
  const views: LoadedView[] = [];
  const failures = new Map<string, DocsError>();
  for (const node of docs) {
    const name = docsViewNameOf(node);
    const nameError = docsViewNameError(node, docs);
    const view =
      nameError === null
        ? loadedView(node)
        : new DocsError("invalid_input", `view ${name}: ${nameError}`, { name, id: node.id });
    if (!(view instanceof DocsError)) views.push(view);
    else if (!failures.has(name)) failures.set(name, view);
  }
  return { views, failures };
}

/** The docs views that can be read, and a line for each docs view node that cannot. */
export interface DocsViews {
  readonly views: readonly LoadedView[];
  readonly warnings: readonly string[];
}

/**
 * Every docs view, sorted by name. One that cannot be read is a warning, not
 * a failure: it leaves the rest to `docs.check`, pre-commit and MCP's
 * resource list.
 */
export const docsViewsEffect = Effect.fn("docs.views")(function* (): Effect.fn.Return<
  DocsViews,
  never,
  KbCtx
> {
  const { views, failures } = readDocsViews((yield* KbCtx).nodes);
  return { views, warnings: [...failures.values()].map((failure) => failure.message) };
});

/** The docs view `name` names, or why there is none it can be. */
export const docsViewEffect = Effect.fn("docs.view")(function* (
  name: string,
): Effect.fn.Return<LoadedView, DocsError, KbCtx> {
  const { views, failures } = readDocsViews((yield* KbCtx).nodes);
  const view = views.find((candidate) => candidate.name === name);
  if (view !== undefined) return view;
  return yield* Effect.fail(
    failures.get(name) ?? new DocsError("not_found", `view not found: ${name}`, { name }),
  );
});
