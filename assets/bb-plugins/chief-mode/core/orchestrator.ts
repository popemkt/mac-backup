// The two delegation moves, over a port so they run the same against bb and a fake:
//   - ensureProjectChief: return the project's chief, adopt a named thread as it, or spawn one;
//   - handoff: give a bb Task to a task architect: a new plain thread, attached to the task on
//     the board, with role metadata and the brief.
// A spawned thread is created with its first message held back (`spawnDeferred`), so its role is
// written before its first turn starts and that turn's session already has the role's tools.
import { buildMeta, type RoleMeta, isTaskKey } from "./model.ts";

export interface TaskInfo {
  id: string;
  key: string;
  title: string;
  description: string;
  status: string;
  trackerProjectId: string;
}

export type Workspace = "project-default" | "new-worktree";

export interface SpawnRequest {
  projectId: string;
  title: string;
  prompt: string;
  workspace: Workspace;
  providerId: string | null;
  model: string | null;
  /** The thread whose agent asked for this spawn, for bb's own attribution. */
  onBehalfOf: string | null;
}

export interface OrchestratorPort {
  getTaskByKey(key: string): Promise<TaskInfo | null>;
  createTask(input: { trackerProjectId: string; title: string; description: string }): Promise<TaskInfo>;
  /** The Tasks tracker project linked to a bb project, if any. */
  trackerProjectFor(bbProjectId: string): Promise<{ id: string; prefix: string } | null>;
  /** The bb project a tracker project is linked to, if any. */
  bbProjectForTracker(trackerProjectId: string): Promise<string | null>;
  projectName(bbProjectId: string): Promise<string>;
  /** Live (not archived) members holding a role, from the index. */
  findMembers(filter: { role: RoleMeta["role"]; projectId?: string; taskKey?: string }): Promise<string[]>;
  threadExists(threadId: string): Promise<boolean>;
  spawnDeferred(request: SpawnRequest): Promise<{ threadId: string; dispatch(): Promise<void> }>;
  send(threadId: string, text: string, from: string | null): Promise<void>;
  writeMeta(threadId: string, meta: RoleMeta): Promise<void>;
  attach(taskId: string, threadId: string): Promise<void>;
  moveTask(taskId: string, status: "in_progress"): Promise<void>;
  now(): number;
}

export class OrchestratorError extends Error {}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function projectChiefBrief(input: { projectName: string; projectId: string; charter: string | null; reportsTo: string | null }): string {
  return [
    `You are the project chief for the bb project ${JSON.stringify(input.projectName)} (${input.projectId}), in the chief-mode hierarchy. Read the chief-mode skill first.`,
    "You own this project's work: turn requests into bb Tasks, hand each task to a task architect with cm_handoff, follow their reports, and decide or escalate.",
    input.reportsTo === null ? "You report to no one yet." : `You report to the coordinator thread ${input.reportsTo}; your final message of each turn is sent there automatically.`,
    input.charter === null ? "Wait for work; start by reading the roster with cm_roster." : `Charter:\n${input.charter}`,
  ].join("\n\n");
}

export function architectBrief(input: { task: TaskInfo; brief: string; reportsTo: string | null }): string {
  const description = input.task.description.trim();
  return [
    `You are the task architect for ${input.task.key}: ${input.task.title}. Read the chief-mode skill first.`,
    "You own this task end to end: do the work (or coordinate helpers you spawn), keep the task's status honest with `bb tasks`, and end every turn with a short status: done, blocked, or needs a decision.",
    input.reportsTo === null ? "No one is set to receive your reports." : `You report to thread ${input.reportsTo}; your final message of each turn is sent there automatically.`,
    description === "" ? null : `Task description:\n${description.length > 4000 ? `${description.slice(0, 4000)}\n…` : description}`,
    `Brief:\n${input.brief.trim()}`,
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n");
}

export interface EnsureChiefInput {
  projectId: string;
  charter: string | null;
  reportsTo: string | null;
  adoptThreadId: string | null;
  /** Title for a spawned chief; defaults to "Project chief — <project>". */
  title?: string | null;
  workspace: Workspace;
  providerId: string | null;
  model: string | null;
}

export interface EnsureChiefResult {
  threadId: string;
  outcome: "existing" | "adopted" | "spawned";
  warnings: string[];
}

export async function ensureProjectChief(port: OrchestratorPort, input: EnsureChiefInput): Promise<EnsureChiefResult> {
  const warnings: string[] = [];
  if (input.adoptThreadId === null) {
    const [existing] = await port.findMembers({ role: "project-chief", projectId: input.projectId });
    if (existing !== undefined) {
      if (input.charter !== null) await port.send(existing, input.charter, input.reportsTo);
      return { threadId: existing, outcome: "existing", warnings };
    }
  }
  const meta = (threadId: string): RoleMeta =>
    buildMeta(threadId, { role: "project-chief", projectId: input.projectId, reportsTo: input.reportsTo }, port.now());
  if (input.adoptThreadId !== null) {
    if (!(await port.threadExists(input.adoptThreadId))) throw new OrchestratorError(`no thread ${input.adoptThreadId}`);
    await port.writeMeta(input.adoptThreadId, meta(input.adoptThreadId));
    if (input.charter !== null) await port.send(input.adoptThreadId, input.charter, input.reportsTo);
    return { threadId: input.adoptThreadId, outcome: "adopted", warnings };
  }
  const projectName = await port.projectName(input.projectId);
  const spawned = await port.spawnDeferred({
    projectId: input.projectId,
    title: input.title ?? `Project chief — ${projectName}`,
    prompt: projectChiefBrief({ projectName, projectId: input.projectId, charter: input.charter, reportsTo: input.reportsTo }),
    workspace: input.workspace,
    providerId: input.providerId,
    model: input.model,
    onBehalfOf: input.reportsTo,
  });
  try {
    await port.writeMeta(spawned.threadId, meta(spawned.threadId));
  } catch (error) {
    warnings.push(`role not written (${errorText(error)}); adopt it with: bb chief-mode adopt ${spawned.threadId} --role project-chief --project ${input.projectId}`);
  }
  await spawned.dispatch();
  return { threadId: spawned.threadId, outcome: "spawned", warnings };
}

export interface HandoffInput {
  /** An existing task, or … */
  taskKey: string | null;
  /** … a new one, created in the tracker project linked to `projectId`. */
  newTask: { title: string; description: string } | null;
  brief: string;
  reportsTo: string | null;
  /** The caller's bb project, used to create a task and as the fallback spawn project. */
  projectId: string | null;
  workspace: Workspace;
  providerId: string | null;
  model: string | null;
  /** Spawn another architect even if the task already has one. */
  force: boolean;
}

export interface HandoffResult {
  threadId: string;
  taskKey: string;
  taskId: string;
  outcome: "existing" | "spawned";
  createdTask: boolean;
  warnings: string[];
}

export async function handoff(port: OrchestratorPort, input: HandoffInput): Promise<HandoffResult> {
  const warnings: string[] = [];
  if (input.brief.trim() === "") throw new OrchestratorError("a handoff needs a brief");
  let task: TaskInfo | null;
  let createdTask = false;
  if (input.taskKey !== null) {
    const key = input.taskKey.trim().toUpperCase();
    if (!isTaskKey(key)) throw new OrchestratorError(`not a task key (like DOT-12): ${input.taskKey}`);
    task = await port.getTaskByKey(key);
    if (task === null) throw new OrchestratorError(`no task ${key}`);
  } else if (input.newTask !== null) {
    if (input.projectId === null) throw new OrchestratorError("creating a task needs a bb project (the caller's, or --project)");
    const tracker = await port.trackerProjectFor(input.projectId);
    if (tracker === null) throw new OrchestratorError(`no bb Tasks project is linked to ${input.projectId}; create the task with \`bb tasks create\` and pass its key`);
    task = await port.createTask({ trackerProjectId: tracker.id, title: input.newTask.title, description: input.newTask.description });
    createdTask = true;
  } else {
    throw new OrchestratorError("name a task key, or a title for a new task");
  }

  if (!input.force) {
    const [existing] = await port.findMembers({ role: "architect", taskKey: task.key });
    if (existing !== undefined) {
      await port.send(existing, input.brief, input.reportsTo);
      return { threadId: existing, taskKey: task.key, taskId: task.id, outcome: "existing", createdTask, warnings };
    }
  }

  const projectId = (await port.bbProjectForTracker(task.trackerProjectId)) ?? input.projectId;
  if (projectId === null) throw new OrchestratorError(`${task.key}'s tracker project is linked to no bb project; pass --project`);

  const spawned = await port.spawnDeferred({
    projectId,
    title: `${task.key} — ${task.title}`,
    prompt: architectBrief({ task, brief: input.brief, reportsTo: input.reportsTo }),
    workspace: input.workspace,
    providerId: input.providerId,
    model: input.model,
    onBehalfOf: input.reportsTo,
  });
  try {
    await port.writeMeta(
      spawned.threadId,
      buildMeta(spawned.threadId, { role: "architect", projectId, taskKey: task.key, taskId: task.id, reportsTo: input.reportsTo }, port.now()),
    );
  } catch (error) {
    warnings.push(`role not written (${errorText(error)})`);
  }
  try {
    await port.attach(task.id, spawned.threadId);
  } catch (error) {
    warnings.push(`not attached to ${task.key} (${errorText(error)}); run: bb tasks attach ${task.key} --thread ${spawned.threadId}`);
  }
  if (task.status === "backlog" || task.status === "todo") {
    try {
      await port.moveTask(task.id, "in_progress");
    } catch (error) {
      warnings.push(`${task.key} not moved to in progress (${errorText(error)})`);
    }
  }
  await spawned.dispatch();
  return { threadId: spawned.threadId, taskKey: task.key, taskId: task.id, outcome: "spawned", createdTask, warnings };
}
