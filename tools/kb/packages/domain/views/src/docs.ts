import { Schema } from "effect";
import { SYSTEM_IDS, firstStr, type DocsViewSpec, type NodeProps } from "@kb/model";
import { viewKey } from "./view-key.ts";

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
  DocsMarkdownParams,
  (props) => {
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
);

/** A docs view's params as the spec the render layer draws. */
export function docsSpecOf(params: DocsMarkdownParams): DocsViewSpec {
  const { template, output } = params;
  return params.query !== undefined
    ? { query: params.query, template, output }
    : { savedQuery: params.savedQuery ?? "", template, output };
}
