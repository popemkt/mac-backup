import type { KbNode, NodeId } from "../../foundation/model.ts";

/**
 * Templates are named TS functions (rows → markdown). No template-language
 * dependency: a view spec references a template by name, resolved here.
 * Every template must be deterministic — same rows + nodes, same bytes.
 */
export interface TemplateContext {
  nodes: Map<NodeId, KbNode>;
  /** Unique-text lookup among sys.field nodes; undefined if absent or ambiguous. */
  fieldIdByName(name: string): NodeId | undefined;
}

export type TemplateFn = (rows: unknown[][], ctx: TemplateContext) => string;

const MENTION_RE = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

/** Render [[id|label]] as label, [[id]] as the target node's text (or the id). */
export function renderText(text: string, ctx: TemplateContext): string {
  return text.replace(MENTION_RE, (_m, id: string, label?: string) => {
    if (label !== undefined && label.length > 0) return label;
    return ctx.nodes.get(id.trim())?.text ?? id.trim();
  });
}

const NO_STATUS = "(no status)";
const STATUS_ORDER = ["doing", "in-progress", "todo", "blocked", "done"];

function statusRank(status: string): number {
  const i = STATUS_ORDER.indexOf(status);
  if (i >= 0) return i;
  return status === NO_STATUS ? STATUS_ORDER.length + 1 : STATUS_ORDER.length;
}

function firstScalar(values: KbNode["props"][string] | undefined): string | undefined {
  const v = values?.find((pv) => pv.t !== "ref");
  return v === undefined ? undefined : String(v.v);
}

/** Todo-tagged nodes grouped by their `status` field value. Rows: [[nodeId], …]. */
export function todos(rows: unknown[][], ctx: TemplateContext): string {
  const statusFieldId = ctx.fieldIdByName("status");
  const ids = [...new Set(rows.map((r) => r[0]).filter((v): v is string => typeof v === "string"))];

  const groups = new Map<string, KbNode[]>();
  for (const id of ids) {
    const node = ctx.nodes.get(id);
    if (!node) continue;
    const status =
      (statusFieldId ? firstScalar(node.props[statusFieldId]) : undefined) ?? NO_STATUS;
    const list = groups.get(status) ?? [];
    list.push(node);
    groups.set(status, list);
  }

  const lines = ["# Todos"];
  if (groups.size === 0) {
    lines.push("", "_No todos._");
    return lines.join("\n");
  }

  const statuses = [...groups.keys()].sort(
    (a, b) => statusRank(a) - statusRank(b) || a.localeCompare(b),
  );
  for (const status of statuses) {
    lines.push("", `## ${status}`, "");
    const nodes = groups
      .get(status)!
      .sort((a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id));
    for (const n of nodes) {
      lines.push(`- ${renderText(n.text, ctx)}`);
    }
  }
  return lines.join("\n");
}

export const templates: Record<string, TemplateFn> = {
  todos,
};
