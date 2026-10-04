import { Result, Schema } from "effect";
import {
  SYSTEM_IDS,
  docsViewNameError,
  docsViewNameOf,
  docsViewProps,
  firstStr,
  isDocsView,
  type DocsViewSpec,
  type KbNode,
  type NodeId,
  type NodeProps,
} from "@kb/model";
import { issueText, paramsIssues, viewKey } from "./view-key.ts";

/** The docs extension's namespace: the server's render layer draws its view. */
export const DOCS_NAMESPACE = "docs";

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

const RepoPath = Schema.NonEmptyString.check(
  Schema.makeFilter((output: string) => isRepoRelative(output), {
    expected: "a repo-relative path without ..",
  }),
);

/**
 * A docs view's settings: the rows of its subject — held as a query
 * (`lens.query`) or named as a saved query (`sys.f.view.saved-query`),
 * exactly one — rendered through a template an extension registers
 * (`sys.f.view.template`) and written to a repo path (`sys.f.view.output`).
 */
export const DocsMarkdownParams = Schema.Struct({
  query: Schema.optionalKey(Schema.NonEmptyString),
  savedQuery: Schema.optionalKey(Schema.NonEmptyString),
  template: Schema.NonEmptyString,
  output: RepoPath,
})
  .annotate({
    description:
      "A markdown document: the rows of its subject, exactly one of a query and a saved query, rendered through a template to a repo-relative output path. Its text is the name it goes by.",
  })
  .check(
    Schema.makeFilter(
      (params: { readonly query?: string; readonly savedQuery?: string }) =>
        (params.query === undefined) !== (params.savedQuery === undefined) ||
        "needs exactly one of a query and a saved query",
    ),
  );
export type DocsMarkdownParams = typeof DocsMarkdownParams.Type;

/** A stored string setting, left out when the node holds none or only an empty one. */
function stored(props: NodeProps, field: string): string | undefined {
  const value = firstStr(field)(props);
  return value === "" ? undefined : value;
}

/**
 * A docs view: a view node naming `docs.markdown`, whose text is the name it
 * goes by (DESIGN.md → Materialization). It reads its settings as stored,
 * leaving out an empty one, so a setting it cannot be read without is named
 * by its params.
 */
export const DocsMarkdownView = viewKey(
  `${DOCS_NAMESPACE}.markdown`,
  "Markdown document",
  DocsMarkdownParams,
  {
    read: (props) => {
      const query = stored(props, SYSTEM_IDS.lensQueryField);
      const savedQuery = stored(props, SYSTEM_IDS.viewSavedQueryField);
      const template = stored(props, SYSTEM_IDS.viewTemplateField);
      const output = stored(props, SYSTEM_IDS.viewOutputField);
      return {
        ...(query === undefined ? {} : { query }),
        ...(savedQuery === undefined ? {} : { savedQuery }),
        ...(template === undefined ? {} : { template }),
        ...(output === undefined ? {} : { output }),
      };
    },
    // What `@kb/model` writes for a docs view (`docsViewProps`), less the view it names.
    write: (params) => {
      const { [SYSTEM_IDS.viewField]: _view, ...settings } = docsViewProps(docsSpecOf(params));
      return settings;
    },
  },
);

/** A docs view's params as the spec the render layer draws. */
export function docsSpecOf(params: DocsMarkdownParams): DocsViewSpec {
  const { template, output } = params;
  return params.query !== undefined
    ? { query: params.query, template, output }
    : { savedQuery: params.savedQuery ?? "", template, output };
}

/**
 * A docs view: a view node naming `docs.markdown` (DESIGN.md → Kinds, roles
 * and options → View nodes), by the name it goes by — its text — and the
 * spec its params hold.
 */
export interface DocsView {
  readonly name: string;
  /** The docs view node. */
  readonly id: NodeId;
  readonly spec: DocsViewSpec;
}

/** Why no docs view goes by a name: none does, or the node that does cannot be read as one. */
export interface DocsViewFault {
  readonly code: "not_found" | "invalid_input";
  readonly message: string;
  readonly details: unknown;
}

/** The docs key reads each setting as stored, so it has nothing to report. */
function ignore(): void {}

/**
 * The docs view a view node is, read through its view's key
 * (`DocsMarkdownView`), or every param it cannot be read without.
 */
function docsViewOf(node: KbNode, name: string): Result.Result<DocsView, DocsViewFault> {
  const params = paramsIssues(
    DocsMarkdownView,
    DocsMarkdownView.config.read(node.props, null, ignore),
  );
  if (Result.isSuccess(params))
    return Result.succeed({ name, id: node.id, spec: docsSpecOf(params.success) });
  return Result.fail({
    code: "invalid_input",
    message: `view ${name} is invalid: ${params.failure.map(issueText).join("; ")}`,
    details: { name, issues: params.failure },
  });
}

/**
 * Every docs view node — a view node whose view is `docs.markdown` — sorted
 * by name, as the view it is or, by the name it goes by, why it cannot be
 * one: its name is no workspace name or another docs view goes by it too
 * (`docsViewNameError`), or a param it cannot be read without is missing.
 */
function readDocsViews(nodes: readonly KbNode[]): {
  views: DocsView[];
  faults: Map<string, DocsViewFault>;
} {
  const docs = nodes
    .filter(isDocsView)
    .toSorted((a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id));
  const views: DocsView[] = [];
  const faults = new Map<string, DocsViewFault>();
  for (const node of docs) {
    const name = docsViewNameOf(node);
    const nameError = docsViewNameError(node, docs);
    const view: Result.Result<DocsView, DocsViewFault> =
      nameError === null
        ? docsViewOf(node, name)
        : Result.fail({
            code: "invalid_input",
            message: `view ${name}: ${nameError}`,
            details: { name, id: node.id },
          });
    if (Result.isSuccess(view)) views.push(view.success);
    else if (!faults.has(name)) faults.set(name, view.failure);
  }
  return { views, faults };
}

/** The docs views that can be read, and a line for each docs view node that cannot. */
export interface DocsViews {
  readonly views: readonly DocsView[];
  readonly warnings: readonly string[];
}

/**
 * Every docs view in `nodes`, sorted by name. One that cannot be read is a
 * warning, not a failure: it leaves the rest to `docs.check`, pre-commit and
 * MCP's resource list.
 */
export function docsViewsOf(nodes: readonly KbNode[]): DocsViews {
  const { views, faults } = readDocsViews(nodes);
  return { views, warnings: [...faults.values()].map((fault) => fault.message) };
}

/** The docs view in `nodes` that `name` names, or why there is none it can be. */
export function docsViewNamed(
  nodes: readonly KbNode[],
  name: string,
): Result.Result<DocsView, DocsViewFault> {
  const { views, faults } = readDocsViews(nodes);
  const view = views.find((candidate) => candidate.name === name);
  if (view !== undefined) return Result.succeed(view);
  return Result.fail(
    faults.get(name) ?? {
      code: "not_found",
      message: `view not found: ${name}`,
      details: { name },
    },
  );
}
