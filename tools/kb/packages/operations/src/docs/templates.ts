import type { KbNode, NodeId } from "@kb/model";

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

/** Todo-tagged nodes grouped by project (if project supertag nodes exist) and `status`. Rows: [[nodeId], …]. */
export function todos(rows: unknown[][], ctx: TemplateContext): string {
  const statusFieldId = ctx.fieldIdByName("status");
  const ids = [...new Set(rows.map((r) => r[0]).filter((v): v is string => typeof v === "string"))];

  if (ids.length === 0) {
    return "# Todos\n\n_No todos._";
  }

  // Discover project tag(s) and project nodes
  const projectTagIds = new Set<NodeId>();
  for (const [id, node] of ctx.nodes) {
    if (node.text === "project") {
      const typeRefs = node.props["sys.f.type"]?.filter((pv) => pv.t === "ref").map((pv) => pv.v);
      if (typeRefs?.includes("sys.tag")) {
        projectTagIds.add(id);
      }
    }
  }

  const projectNodes = new Map<NodeId, KbNode>();
  if (projectTagIds.size > 0) {
    for (const [id, node] of ctx.nodes) {
      const typeRefs = node.props["sys.f.type"]?.filter((pv) => pv.t === "ref").map((pv) => pv.v) ?? [];
      if (typeRefs.some((ref) => projectTagIds.has(ref))) {
        projectNodes.set(id, node);
      }
    }
  }

  if (projectNodes.size > 0) {
    const nodeToProject = new Map<NodeId, string>();
    for (const [, projNode] of projectNodes) {
      const queue = [...projNode.children];
      while (queue.length > 0) {
        const childId = queue.shift()!;
        if (!nodeToProject.has(childId)) {
          nodeToProject.set(childId, projNode.text);
          const childNode = ctx.nodes.get(childId);
          if (childNode && childNode.children.length > 0) {
            queue.push(...childNode.children);
          }
        }
      }
    }

    const projectGroups = new Map<string, Map<string, KbNode[]>>();
    const sortedProjects = [...projectNodes.values()]
      .map((p) => p.text)
      .sort((a, b) => a.localeCompare(b));
    for (const pName of sortedProjects) {
      projectGroups.set(pName, new Map());
    }

    for (const id of ids) {
      const node = ctx.nodes.get(id);
      if (!node) continue;
      const projName = nodeToProject.get(id) ?? "(other)";
      let statusMap = projectGroups.get(projName);
      if (!statusMap) {
        statusMap = new Map();
        projectGroups.set(projName, statusMap);
      }
      const status =
        (statusFieldId ? firstScalar(node.props[statusFieldId]) : undefined) ?? NO_STATUS;
      const list = statusMap.get(status) ?? [];
      list.push(node);
      statusMap.set(status, list);
    }

    const lines = ["# Todos"];
    let totalCount = 0;
    for (const [projName, statusMap] of projectGroups) {
      if (statusMap.size === 0) continue;
      lines.push("", `## ${projName}`);
      const statuses = [...statusMap.keys()].sort(
        (a, b) => statusRank(a) - statusRank(b) || a.localeCompare(b),
      );
      for (const status of statuses) {
        lines.push("", `### ${status}`, "");
        const nodes = statusMap
          .get(status)!
          .sort((a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id));
        for (const n of nodes) {
          lines.push(`- ${renderText(n.text, ctx)}`);
          totalCount++;
        }
      }
    }

    if (totalCount === 0) {
      return "# Todos\n\n_No todos._";
    }
    return lines.join("\n");
  }

  // Fallback flat status grouping when no project supertag nodes exist
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
