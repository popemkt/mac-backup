import { Effect, Result } from "effect";
import { KbCtx } from "@kb/contracts";
import {
  docsViewNameError,
  docsViewNameOf,
  isDocsView,
  type DocsViewSpec,
  type FailureCode,
  type KbNode,
} from "@kb/model";
import { DocsMarkdownView, docsSpecOf, issueText, paramsIssues } from "@kb/views";

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
 * The docs view a view node is, read through its view's key
 * (`DocsMarkdownView`), or every param it cannot be read without.
 */
function loadedView(node: KbNode): LoadedView | DocsError {
  const name = docsViewNameOf(node);
  const params = paramsIssues(DocsMarkdownView, DocsMarkdownView.config(node.props, null, ignore));
  if (Result.isSuccess(params)) return { name, spec: docsSpecOf(params.success) };
  return new DocsError(
    "invalid_input",
    `view ${name} is invalid: ${params.failure.map(issueText).join("; ")}`,
    { name, issues: params.failure },
  );
}

/** The docs key reads each setting as stored, so it has nothing to report. */
function ignore(): void {}

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
