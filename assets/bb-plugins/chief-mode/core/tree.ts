// The roster: coordinator → project chief → task → architect, built from nothing but the threads'
// role metadata, their live thread facts and the tasks they name. Pure, so the same function
// serves the Chief page, `bb chief-mode roster` and `cm_roster`, and a lost cache rebuilds to the
// same tree.
import { type Role, type RoleMeta, ROLE_LABEL } from "./model.ts";

export interface ThreadFacts {
  id: string;
  title: string;
  status: string;
  projectId: string;
  archived: boolean;
  /** Pending interactions (approvals, questions) waiting on a person. */
  pending: number;
}

export interface TaskFacts {
  key: string;
  title: string;
  status: string;
}

export interface Member {
  threadId: string;
  role: Role;
  title: string;
  status: string;
  pending: number;
  reportsTo: string | null;
  projectId: string | null;
  taskKey: string | null;
}

export interface TaskNode {
  key: string;
  title: string;
  status: string | null;
  architects: Member[];
}

export interface ProjectNode {
  projectId: string;
  name: string;
  chiefs: Member[];
  tasks: TaskNode[];
}

export interface Roster {
  coordinators: Member[];
  projects: ProjectNode[];
  totals: { members: number; pending: number; working: number };
}

export interface RosterInput {
  members: { meta: RoleMeta; thread: ThreadFacts }[];
  tasks: ReadonlyMap<string, TaskFacts>;
  projectNames: ReadonlyMap<string, string>;
}

const WORKING = new Set(["active", "starting", "pending", "stopping"]);

const byTitle = (a: Member, b: Member): number => a.title.localeCompare(b.title) || a.threadId.localeCompare(b.threadId);

/** Task keys sort by project prefix, then number (DOT-9 before DOT-10). */
export function compareTaskKeys(a: string, b: string): number {
  const [pa = "", na = "0"] = a.split("-");
  const [pb = "", nb = "0"] = b.split("-");
  return pa.localeCompare(pb) || Number(na) - Number(nb);
}

export function buildRoster(input: RosterInput): Roster {
  const coordinators: Member[] = [];
  const projects = new Map<string, ProjectNode>();
  const project = (projectId: string): ProjectNode => {
    let node = projects.get(projectId);
    if (node === undefined) {
      node = { projectId, name: input.projectNames.get(projectId) ?? projectId, chiefs: [], tasks: [] };
      projects.set(projectId, node);
    }
    return node;
  };
  let pending = 0;
  let working = 0;
  let count = 0;
  for (const { meta, thread } of input.members) {
    if (thread.archived) continue;
    count += 1;
    pending += thread.pending;
    if (WORKING.has(thread.status)) working += 1;
    const member: Member = {
      threadId: thread.id,
      role: meta.role,
      title: thread.title,
      status: thread.status,
      pending: thread.pending,
      reportsTo: meta.reportsTo,
      projectId: meta.projectId,
      taskKey: meta.taskKey,
    };
    if (meta.role === "coordinator") {
      coordinators.push(member);
      continue;
    }
    // A role without a project link still belongs somewhere: the thread's own project.
    const node = project(meta.projectId ?? thread.projectId);
    if (meta.role === "project-chief") {
      node.chiefs.push(member);
      continue;
    }
    const key = meta.taskKey ?? "(no task)";
    let task = node.tasks.find((candidate) => candidate.key === key);
    if (task === undefined) {
      const facts = meta.taskKey === null ? undefined : input.tasks.get(meta.taskKey);
      task = { key, title: facts?.title ?? "", status: facts?.status ?? null, architects: [] };
      node.tasks.push(task);
    }
    task.architects.push(member);
  }
  coordinators.sort(byTitle);
  const ordered = [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const node of ordered) {
    node.chiefs.sort(byTitle);
    node.tasks.sort((a, b) => compareTaskKeys(a.key, b.key));
    for (const task of node.tasks) task.architects.sort(byTitle);
  }
  return { coordinators, projects: ordered, totals: { members: count, pending, working } };
}

const statusTag = (member: Member): string => `[${member.status}${member.pending > 0 ? `, ${member.pending} waiting on you` : ""}]`;

/** The roster as indented text, for the CLI and the agent tool. Bounded by `maxLines`. */
export function formatRoster(roster: Roster, maxLines = 400): string {
  const lines: string[] = [];
  if (roster.coordinators.length === 0) lines.push("Coordinator: none (adopt one: bb chief-mode adopt <thread> --role coordinator)");
  for (const coordinator of roster.coordinators) lines.push(`${ROLE_LABEL.coordinator}: ${coordinator.title} ${coordinator.threadId} ${statusTag(coordinator)}`);
  for (const node of roster.projects) {
    lines.push(`  Project ${node.name} (${node.projectId})`);
    if (node.chiefs.length === 0) lines.push("    Project chief: none");
    for (const chief of node.chiefs) lines.push(`    ${ROLE_LABEL["project-chief"]}: ${chief.title} ${chief.threadId} ${statusTag(chief)}`);
    for (const task of node.tasks) {
      lines.push(`      ${task.key}${task.title === "" ? "" : ` ${task.title}`}${task.status === null ? "" : ` (${task.status})`}`);
      for (const architect of task.architects) lines.push(`        ${ROLE_LABEL.architect}: ${architect.title} ${architect.threadId} ${statusTag(architect)}`);
    }
  }
  lines.push(`${roster.totals.members} members, ${roster.totals.working} working, ${roster.totals.pending} waiting on you.`);
  if (lines.length > maxLines) return [...lines.slice(0, maxLines - 1), `… ${lines.length - maxLines + 1} more lines (narrow with --project)`].join("\n");
  return lines.join("\n");
}

/** Narrow a roster to one project (the coordinators stay, as the root). */
export function scopeRoster(roster: Roster, projectId: string | null): Roster {
  if (projectId === null) return roster;
  return { ...roster, projects: roster.projects.filter((node) => node.projectId === projectId) };
}
