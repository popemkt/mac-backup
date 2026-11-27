// The overlay's data model: a role and its links, kept as this plugin's metadata namespace on an
// ordinary bb thread (`threads.updatePluginMetadata`). Nothing else marks a thread as part of the
// hierarchy, so any thread can join (adopt) or leave it, and every other plugin keeps seeing a
// plain thread.
//
// Metadata is writable by any API client, any plugin and the thread's own agent, so it is parsed
// here at the boundary and never trusted as authorization: a well-formed value only selects tools
// that are safe whoever wrote it (spawning and messaging threads, which `bb thread` already allows
// every agent).

export const ROLES = ["coordinator", "project-chief", "architect"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  coordinator: "Coordinator",
  "project-chief": "Project chief",
  architect: "Task architect",
};

/** The metadata schema version this code writes. */
export const META_VERSION = 1;

export interface RoleMeta {
  v: number;
  role: Role;
  /** The bb project a project chief or architect works in (`proj_…`). A coordinator spans all. */
  projectId: string | null;
  /** The bb Tasks key an architect owns (`DOT-12`). */
  taskKey: string | null;
  /** The bb Tasks ULID of that task, when known. */
  taskId: string | null;
  /** The thread this one reports to (`thr_…`); null for the coordinator. */
  reportsTo: string | null;
  /** Epoch ms the role was written. */
  since: number;
  /** Whether a finished turn is sent up automatically; absent means yes. */
  autoReport: boolean;
}

const THREAD_ID = /^thr_[A-Za-z0-9]{4,64}$/u;
const PROJECT_ID = /^proj_[A-Za-z0-9]{4,64}$/u;
const TASK_KEY = /^[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}$/u;
const TASK_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

export const isThreadId = (value: unknown): value is string => typeof value === "string" && THREAD_ID.test(value);
export const isProjectId = (value: unknown): value is string => typeof value === "string" && PROJECT_ID.test(value);
export const isTaskKey = (value: unknown): value is string => typeof value === "string" && TASK_KEY.test(value);
export const isTaskId = (value: unknown): value is string => typeof value === "string" && TASK_ID.test(value);
export const isRole = (value: unknown): value is Role => typeof value === "string" && (ROLES as readonly string[]).includes(value);

/** Accepts the spellings a person or agent is likely to type for a role. */
export function parseRole(input: string): Role | null {
  const normalized = input.trim().toLowerCase().replace(/[\s_]+/gu, "-");
  if (isRole(normalized)) return normalized;
  const aliases: Record<string, Role> = {
    chief: "coordinator",
    coord: "coordinator",
    captain: "project-chief",
    "project-captain": "project-chief",
    pc: "project-chief",
    projectchief: "project-chief",
    "task-architect": "architect",
    arch: "architect",
  };
  return aliases[normalized] ?? null;
}

/**
 * The role metadata of one thread, or null when the namespace holds no valid role. Unknown keys
 * are ignored, so a later version's extra fields do not drop a thread from the tree; a malformed
 * link becomes null rather than invalidating the role.
 */
export function parseMeta(raw: unknown): RoleMeta | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!isRole(value.role)) return null;
  return {
    v: typeof value.v === "number" && Number.isFinite(value.v) ? value.v : META_VERSION,
    role: value.role,
    projectId: isProjectId(value.projectId) ? value.projectId : null,
    taskKey: isTaskKey(value.taskKey) ? value.taskKey : null,
    taskId: isTaskId(value.taskId) ? value.taskId : null,
    reportsTo: isThreadId(value.reportsTo) ? value.reportsTo : null,
    since: typeof value.since === "number" && Number.isFinite(value.since) ? value.since : 0,
    autoReport: value.autoReport !== false,
  };
}

export interface RoleInput {
  role: Role;
  projectId?: string | null;
  taskKey?: string | null;
  taskId?: string | null;
  reportsTo?: string | null;
  autoReport?: boolean;
}

export class RoleError extends Error {}

/**
 * Validates a role assignment for `threadId` and returns the metadata to write. Rules: a project
 * chief names its project; an architect names its task; nothing reports to itself.
 */
export function buildMeta(threadId: string, input: RoleInput, now: number): RoleMeta {
  const projectId = input.projectId ?? null;
  const taskKey = input.taskKey ?? null;
  const taskId = input.taskId ?? null;
  const reportsTo = input.reportsTo ?? null;
  if (projectId !== null && !isProjectId(projectId)) throw new RoleError(`not a bb project id: ${projectId}`);
  if (taskKey !== null && !isTaskKey(taskKey)) throw new RoleError(`not a task key (like DOT-12): ${taskKey}`);
  if (taskId !== null && !isTaskId(taskId)) throw new RoleError(`not a task id: ${taskId}`);
  if (reportsTo !== null && !isThreadId(reportsTo)) throw new RoleError(`not a thread id: ${reportsTo}`);
  if (reportsTo === threadId) throw new RoleError("a thread cannot report to itself");
  if (input.role === "project-chief" && projectId === null) throw new RoleError("a project chief needs a project");
  if (input.role === "architect" && taskKey === null) throw new RoleError("a task architect needs a task key");
  return {
    v: META_VERSION,
    role: input.role,
    projectId: input.role === "coordinator" ? null : projectId,
    taskKey: input.role === "architect" ? taskKey : null,
    taskId: input.role === "architect" ? taskId : null,
    reportsTo,
    since: now,
    autoReport: input.autoReport !== false,
  };
}

/** The JSON object written to the namespace (all keys, so a re-adoption clears stale links). */
export function metaRecord(meta: RoleMeta): Record<string, string | number | boolean | null> {
  return { ...meta };
}

/**
 * True when following `reportsTo` from `start` (with `start` about to report to `target`) would
 * come back to `start`: such a chain would bounce reports forever.
 */
export function wouldCycle(start: string, target: string | null, reportsToOf: (threadId: string) => string | null): boolean {
  const seen = new Set<string>([start]);
  let cursor = target;
  for (let hops = 0; cursor !== null && hops < 64; hops += 1) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = reportsToOf(cursor);
  }
  return false;
}
