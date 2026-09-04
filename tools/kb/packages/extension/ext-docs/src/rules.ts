import type { KbNode, NodeId } from "@kb/model";
import type { TemplateContext } from "@kb/contracts";
import { renderText } from "@kb/operations";

/**
 * The `rules` template: the repo's rule and gap index, rendered from the
 * graph. Policy, so it lives with the policy that asks for it — registered
 * as `ext.docs.rules` with the bare id `rules` as an alias.
 */

/** Strongest enforcement first, so `prose` rows (nothing checks them) sink. */
const ENFORCEMENT_ORDER = ["hook", "ci", "harness", "tsc", "lint", "prose"];

function enforcementRank(value: string): number {
  const i = ENFORCEMENT_ORDER.indexOf(value);
  return i >= 0 ? i : ENFORCEMENT_ORDER.length;
}

function typeRefIds(node: KbNode): NodeId[] {
  return (node.props["sys.f.type"] ?? []).filter((pv) => pv.t === "ref").map((pv) => pv.v);
}

/** Ids of tag nodes whose text is `name` (a tag is a node typed `sys.tag`). */
function tagIdsNamed(ctx: TemplateContext, name: string): Set<NodeId> {
  const ids = new Set<NodeId>();
  for (const [id, node] of ctx.nodes) {
    if (node.text === name && typeRefIds(node).includes("sys.tag")) ids.add(id);
  }
  return ids;
}

function nodesTagged(ctx: TemplateContext, tagIds: Set<NodeId>): KbNode[] {
  const out: KbNode[] = [];
  for (const [, node] of ctx.nodes) {
    if (typeRefIds(node).some((ref) => tagIds.has(ref))) out.push(node);
  }
  return out;
}

/** First value of `field` on `node`, refs resolved to the target's text. */
function propText(ctx: TemplateContext, node: KbNode, field: string): string | undefined {
  const fieldId = ctx.fieldIdByName(field);
  const value = fieldId === undefined ? undefined : node.props[fieldId]?.[0];
  if (value === undefined) return undefined;
  if (value.t === "ref") {
    return ctx.nodes.get(value.v)?.text ?? value.v;
  }
  return renderText(String(value.v), ctx);
}

/** Markdown table cells are single-line and `|` terminates one. */
function cell(value: string | undefined): string {
  if (value === undefined || value === "") return "—";
  return value.replaceAll("|", "\\|").replaceAll(/\s*\n\s*/g, " ");
}

/**
 * `#rule` nodes as a table with an honest enforcement column, then the
 * `#gap` nodes. Rows: `[[nodeId], …]` — the gaps come from the graph, so
 * one view renders the whole rules index.
 */
export function rules(rows: unknown[][], ctx: TemplateContext): string {
  const ruleIds = [
    ...new Set(rows.map((r) => r[0]).filter((v): v is string => typeof v === "string")),
  ];
  const ruleNodes = ruleIds
    .map((id) => ctx.nodes.get(id))
    .filter((n): n is KbNode => n !== undefined)
    .toSorted(
      (a, b) =>
        enforcementRank(propText(ctx, a, "enforcement") ?? "") -
          enforcementRank(propText(ctx, b, "enforcement") ?? "") || a.text.localeCompare(b.text),
    );

  const lines = [
    "# Rules",
    "",
    "Every rule that governs this repo, with its one home and what actually",
    "checks it. `enforcement` is honest: **`prose` means nothing checks it** —",
    "`gate` names the check that will.",
    "",
    "## Rules",
    "",
    "| Rule | Home | Scope | Principle | Enforcement | Gate |",
    "|---|---|---|---|---|---|",
  ];
  if (ruleNodes.length === 0) {
    lines.push("| _no rules recorded_ | — | — | — | — | — |");
  }
  for (const node of ruleNodes) {
    lines.push(
      `| ${cell(renderText(node.text, ctx))} | ${cell(propText(ctx, node, "home"))} | ` +
        `${cell(propText(ctx, node, "scope"))} | ${cell(propText(ctx, node, "principle"))} | ` +
        `${cell(propText(ctx, node, "enforcement"))} | ${cell(propText(ctx, node, "gate"))} |`,
    );
  }

  const gapNodes = nodesTagged(ctx, tagIdsNamed(ctx, "gap")).toSorted(
    (a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id),
  );
  lines.push("", "## Gaps", "");
  if (gapNodes.length === 0) {
    lines.push("_No gaps recorded._");
  }
  for (const node of gapNodes) {
    lines.push(`### ${renderText(node.text, ctx)}`, "");
    for (const field of ["expected", "current", "impact", "closes", "rule"]) {
      const value = propText(ctx, node, field);
      if (value !== undefined && value !== "") {
        lines.push(`- **${field}** — ${value.replaceAll(/\s*\n\s*/g, " ")}`);
      }
    }
    lines.push(`- **node** — \`${node.id}\``, "");
  }

  return lines.join("\n");
}
