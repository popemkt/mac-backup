/**
 * A view node on a surface that shows text (Claude Code renders no `ui://`
 * resource): its heading — which view it is, shown for which node — then a
 * body the view draws, and, for a page, a figure drawn above the text.
 *
 * A view draws its own body when it knows how to say itself in text
 * ({@link VIEW_BODIES}). Any other view's body is the settings its key reads
 * from the node for the node it is shown for, and the nodes it shows, read
 * the one way every view node can be read: a lens query when the node holds
 * one (empty means every node, as a graph reads it), else the children of the
 * node it is shown for. How such a view would lay them out — filtered,
 * sorted, grouped, a column per field, drawn as a graph — is not drawn here.
 * GAP [[01M40X30G92A0E57C02JHQ9A1G]]
 */
import { Effect, Predicate, Result } from "effect";
import type { KbContext } from "@kb/contracts";
import { SYSTEM_IDS, firstStr, hostViewIds, viewOptionOf, type KbNode } from "@kb/model";
import {
  ChartView,
  CodeView,
  catalogKeyOf,
  issueText,
  paramsIssues,
  viewLabelOf,
  type ViewKey,
} from "@kb/views";
import { chartBody } from "./chart-text.ts";
import { codeBody } from "./code-text.ts";

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

/** What a view draws under its heading: markdown lines, and a figure for a page. */
interface ViewBody {
  readonly lines: readonly string[];
  /** Html a page draws above the text (a chart's SVG); absent, or null, when there is none. */
  readonly figure?: Effect.Effect<string | null>;
}

/** How one view says itself in text, from the settings its key read for the node it is shown for. */
interface OwnBody<P> {
  readonly key: ViewKey<P>;
  draw(ctx: KbContext, params: P, host: KbNode | null): ViewBody;
}

/** A view's own body, drawn from the params its key decodes. */
function ownBody<P>(key: ViewKey<P>, draw: OwnBody<P>["draw"]): OwnBody<P> {
  return { key, draw };
}

/**
 * The views that draw their own body, each by its key. A core table naming
 * feature views: GAP [[01M41H2ZG7C0SV1DYZE6MMKPFE]]
 */
const VIEW_BODIES: readonly OwnBody<unknown>[] = [
  ownBody(ChartView, (ctx, params) => chartBody(ctx, params)),
  ownBody(CodeView, (_ctx, params) => codeBody(params)),
];

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

/** The body of a view that draws none of its own: its settings, then its subject. */
function settingsAndSubject(
  ctx: KbContext,
  view: KbNode,
  host: KbNode | null,
  params: Result.Result<unknown, string> | null,
  reported: readonly string[],
): readonly string[] {
  const lines: string[] = [];
  if (params !== null) {
    lines.push("", "## Settings", "");
    if (Result.isSuccess(params) && Predicate.isObject(params.success)) {
      const entries = Object.entries(params.success);
      if (entries.length === 0) lines.push("None.");
      for (const [setting, value] of entries) lines.push(`- ${setting}: ${JSON.stringify(value)}`);
    } else if (Result.isFailure(params)) {
      lines.push(`This view node cannot be read: ${params.failure}`);
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
  return lines;
}

/** A view node on a text surface: its markdown, and the figure a page draws above it. */
interface ViewText {
  readonly markdown: string;
  readonly figure: Effect.Effect<string | null>;
}

/** What a view node is shown as on a text-only surface. */
export function viewText(ctx: KbContext, view: KbNode, host: KbNode | null): ViewText {
  const option = viewOptionOf(view);
  const key = option === null ? null : catalogKeyOf(option);
  const lines = [`# ${viewTitleOf(view, key)}`, ""];
  const shownFor = host === null ? "" : `, shown for ${host.text.trim() || host.id} (${host.id})`;
  lines.push(
    key === null
      ? `View node ${view.id} names ${option ?? "no view"}, which is no view kb provides.`
      : `${viewLabelOf(key)} view (${key.id}), view node ${view.id}${shownFor}.`,
  );
  const reported: string[] = [];
  const params =
    key === null
      ? null
      : Result.mapError(
          paramsIssues(
            key,
            key.config.read(view.props, host?.id ?? null, (warning) => reported.push(warning)),
          ),
          (issues) => issues.map(issueText).join("; "),
        );
  const own = VIEW_BODIES.find((entry) => entry.key === key);
  const body: ViewBody =
    own !== undefined && params !== null && Result.isSuccess(params)
      ? own.draw(ctx, params.success, host)
      : { lines: settingsAndSubject(ctx, view, host, params, reported) };
  return {
    markdown: `${[...lines, ...body.lines].join("\n")}\n`,
    figure: body.figure ?? Effect.succeed(null),
  };
}
