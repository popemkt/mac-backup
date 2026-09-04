import type { KbNode, NodeId } from "@kb/model";
import type { TemplateContext } from "@kb/contracts";
import { renderText } from "@kb/operations";

/**
 * The `todos` template: repo-doc policy, not core mechanism. Registered as
 * `ext.docs.todos` with the bare id `todos` as an alias so existing view
 * specs keep resolving.
 */
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

function nodeStatus(node: KbNode, statusFieldId: NodeId | undefined): string {
  return (
    (statusFieldId !== undefined ? firstScalar(node.props[statusFieldId]) : undefined) ?? NO_STATUS
  );
}

function collectProjectNodes(ctx: TemplateContext): Map<NodeId, KbNode> {
  const projectTagIds = new Set<NodeId>();
  for (const [id, node] of ctx.nodes) {
    if (node.text !== "project") continue;
    const typeRefs = node.props["sys.f.type"]?.filter((pv) => pv.t === "ref").map((pv) => pv.v);
    if (typeRefs?.includes("sys.tag") === true) projectTagIds.add(id);
  }
  const projectNodes = new Map<NodeId, KbNode>();
  if (projectTagIds.size === 0) return projectNodes;
  for (const [id, node] of ctx.nodes) {
    const typeRefs =
      node.props["sys.f.type"]?.filter((pv) => pv.t === "ref").map((pv) => pv.v) ?? [];
    if (typeRefs.some((ref) => projectTagIds.has(ref))) projectNodes.set(id, node);
  }
  return projectNodes;
}

function renderStatusGroups(
  groups: Map<string, KbNode[]>,
  ctx: TemplateContext,
  heading: (status: string) => string,
): string[] {
  const lines: string[] = [];
  const statuses = [...groups.keys()].toSorted(
    (a, b) => statusRank(a) - statusRank(b) || a.localeCompare(b),
  );
  for (const status of statuses) {
    const nodes = groups.get(status);
    if (nodes === undefined) continue;
    lines.push("", heading(status), "");
    for (const n of nodes.toSorted(
      (a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id),
    )) {
      lines.push(`- ${renderText(n.text, ctx)}`);
    }
  }
  return lines;
}

function todosByProject(
  ids: string[],
  ctx: TemplateContext,
  statusFieldId: NodeId | undefined,
  projectNodes: Map<NodeId, KbNode>,
): string {
  const nodeToProject = new Map<NodeId, string>();
  for (const [, projNode] of projectNodes) {
    const queue = [...projNode.children];
    while (queue.length > 0) {
      const childId = queue.shift();
      if (childId === undefined) break;
      if (!nodeToProject.has(childId)) {
        nodeToProject.set(childId, projNode.text);
        const childNode = ctx.nodes.get(childId);
        if (childNode !== undefined && childNode.children.length > 0) {
          queue.push(...childNode.children);
        }
      }
    }
  }

  const projectGroups = new Map<string, Map<string, KbNode[]>>();
  const sortedProjects = [...projectNodes.values()]
    .map((p) => p.text)
    .toSorted((a, b) => a.localeCompare(b));
  for (const pName of sortedProjects) projectGroups.set(pName, new Map());

  for (const id of ids) {
    const node = ctx.nodes.get(id);
    if (node === undefined) continue;
    const projName = nodeToProject.get(id) ?? "(other)";
    let statusMap = projectGroups.get(projName);
    if (statusMap === undefined) {
      statusMap = new Map();
      projectGroups.set(projName, statusMap);
    }
    const status = nodeStatus(node, statusFieldId);
    const list = statusMap.get(status) ?? [];
    list.push(node);
    statusMap.set(status, list);
  }

  const lines = ["# Todos"];
  let totalCount = 0;
  for (const [projName, statusMap] of projectGroups) {
    if (statusMap.size === 0) continue;
    lines.push("", `## ${projName}`);
    const section = renderStatusGroups(statusMap, ctx, (status) => `### ${status}`);
    totalCount += section.filter((l) => l.startsWith("- ")).length;
    lines.push(...section);
  }
  if (totalCount === 0) return "# Todos\n\n_No todos._";
  return lines.join("\n");
}

function todosFlat(ids: string[], ctx: TemplateContext, statusFieldId: NodeId | undefined): string {
  const groups = new Map<string, KbNode[]>();
  for (const id of ids) {
    const node = ctx.nodes.get(id);
    if (node === undefined) continue;
    const status = nodeStatus(node, statusFieldId);
    const list = groups.get(status) ?? [];
    list.push(node);
    groups.set(status, list);
  }
  return ["# Todos", ...renderStatusGroups(groups, ctx, (status) => `## ${status}`)].join("\n");
}

/** Todo-tagged nodes grouped by project (if project supertag nodes exist) and `status`. Rows: [[nodeId], …]. */
export function todos(rows: unknown[][], ctx: TemplateContext): string {
  const statusFieldId = ctx.fieldIdByName("status");
  const ids = [...new Set(rows.map((r) => r[0]).filter((v): v is string => typeof v === "string"))];
  if (ids.length === 0) return "# Todos\n\n_No todos._";
  const projectNodes = collectProjectNodes(ctx);
  if (projectNodes.size > 0) return todosByProject(ids, ctx, statusFieldId, projectNodes);
  return todosFlat(ids, ctx, statusFieldId);
}
