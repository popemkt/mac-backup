/**
 * A view node as markdown, for a surface that shows text only (Claude Code
 * renders no `ui://` resource): which view it is, the settings its key reads
 * from it for the node it is shown for, and the nodes it shows.
 *
 * The rows are the view's subject, read the one way every view node can be
 * read: a lens query when the node holds one (empty means every node, as a
 * graph reads it), else the children of the node it is shown for. How the
 * view itself would lay them out — filtered, sorted, grouped, a column per
 * field, drawn as a graph — is not drawn here.
 * GAP [GAP-VIEW-MARKDOWN]
 */
import { Predicate, Result } from "effect";
import type { KbContext } from "@kb/contracts";
import { SYSTEM_IDS, firstStr, hostViewIds, viewOptionOf, type KbNode } from "@kb/model";
import { catalogKeyOf, issueText, paramsIssues, viewLabelOf, type ViewKey } from "@kb/views";

/** How many of a view's rows its markdown lists. */
const MAX_ROWS = 100;

/** The node a view node is shown for: the one asked for, else the one node naming it. */
export function hostOf(ctx: KbContext, view: KbNode, asked: string | null): KbNode | null {
  if (asked !== null) return ctx.index.getNode(asked) ?? null;
  const naming = ctx.nodes.filter((node) => hostViewIds(node).includes(view.id));
  return naming.length === 1 ? (naming[0] ?? null) : null;
}

/** A view node's title: its text, else what its view is called. */
export function viewTitleOf(view: KbNode, key: ViewKey<unknown> | null): string {
  const text = view.text.trim();
  if (text !== "") return text;
  return key === null ? view.id : `${viewLabelOf(key)} view`;
}

function nodeLine(ctx: KbContext, id: string): string {
  const text = ctx.index.getNode(id)?.text.trim() ?? "";
  return `- ${text === "" ? "(untitled)" : text} (${id})`;
}

/** The ids a view node's subject holds, or why they cannot be read. */
function subjectOf(
  ctx: KbContext,
  view: KbNode,
  host: KbNode | null,
): { heading: string; ids: readonly string[] } | { heading: string; error: string } | null {
  const query = firstStr(SYSTEM_IDS.lensQueryField)(view.props);
  if (query !== undefined) {
    if (query === "") return { heading: "Nodes", ids: ctx.nodes.map((node) => node.id) };
    try {
      const rows = ctx.index.runDatalog(query);
      const ids = rows.flatMap((row) =>
        Array.isArray(row) && Predicate.isString(row[0]) ? [row[0]] : [],
      );
      return { heading: "Nodes", ids };
    } catch (err) {
      return { heading: "Nodes", error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (host !== null) return { heading: "Rows", ids: host.children };
  return null;
}

/** The markdown a view node is shown as on a text-only surface. */
export function viewMarkdown(ctx: KbContext, view: KbNode, host: KbNode | null): string {
  const option = viewOptionOf(view);
  const key = option === null ? null : catalogKeyOf(option);
  const lines = [`# ${viewTitleOf(view, key)}`, ""];
  const shownFor = host === null ? "" : `, shown for ${host.text.trim() || host.id} (${host.id})`;
  lines.push(
    key === null
      ? `View node ${view.id} names ${option ?? "no view"}, which is no view kb provides.`
      : `${viewLabelOf(key)} view (${key.id}), view node ${view.id}${shownFor}.`,
  );
  if (key !== null) {
    const reported: string[] = [];
    const params = paramsIssues(
      key,
      key.config.read(view.props, host?.id ?? null, (warning) => reported.push(warning)),
    );
    lines.push("", "## Settings", "");
    if (Result.isSuccess(params) && Predicate.isObject(params.success)) {
      const entries = Object.entries(params.success);
      if (entries.length === 0) lines.push("None.");
      for (const [setting, value] of entries) lines.push(`- ${setting}: ${JSON.stringify(value)}`);
    } else if (Result.isFailure(params)) {
      lines.push(`This view node cannot be read: ${params.failure.map(issueText).join("; ")}`);
    }
    for (const warning of reported) lines.push(`- ignored: ${warning}`);
  }
  const subject = subjectOf(ctx, view, host);
  if (subject !== null) {
    lines.push("", `## ${subject.heading}`, "");
    if ("error" in subject) lines.push(`Its query cannot be run: ${subject.error}`);
    else {
      if (subject.ids.length === 0) lines.push("None.");
      for (const id of subject.ids.slice(0, MAX_ROWS)) lines.push(nodeLine(ctx, id));
      if (subject.ids.length > MAX_ROWS) lines.push(`- and ${subject.ids.length - MAX_ROWS} more`);
    }
  }
  return `${lines.join("\n")}\n`;
}
