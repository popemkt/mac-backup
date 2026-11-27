// bb Tasks, reached through the built-in tasks plugin's RPC (`plugins.callRpc`). That contract is
// internal to bb, so every output is parsed loosely here (only the fields this plugin reads) and
// the rest of the plugin sees TaskInfo only. Tasks emits no events: the roster re-reads task facts
// with a short cache instead.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { TaskInfo } from "../core/orchestrator.ts";
import type { TaskFacts } from "../core/tree.ts";

export const TASKS_PLUGIN_ID = "tasks";

const taskSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    key: z.string(),
    title: z.string(),
    description: z.string().default(""),
    status: z.string(),
  })
  .loose();

const projectSchema = z
  .object({ id: z.string(), prefix: z.string(), linkedBbProjectId: z.string().nullable().default(null) })
  .loose();

const mutationSchema = z.union([
  z.object({ ok: z.literal(true), task: taskSchema }).loose(),
  z.object({ ok: z.literal(false), error: z.unknown() }).loose(),
]);

type Task = z.infer<typeof taskSchema>;

const toInfo = (task: Task): TaskInfo => ({
  id: task.id,
  key: task.key,
  title: task.title,
  description: task.description,
  status: task.status,
  trackerProjectId: task.projectId,
});

function mutationTask(result: z.infer<typeof mutationSchema>, what: string): Task {
  if (result.ok) return result.task;
  const error = result.error as { message?: unknown } | null;
  throw new Error(`${what}: ${typeof error?.message === "string" ? error.message : JSON.stringify(result.error)}`);
}

export function createTasksClient(bb: BbPluginApi, now: () => number = Date.now) {
  const call = <T>(method: string, input: Record<string, unknown>, outputSchema: z.ZodType<T>): Promise<T> =>
    bb.sdk.plugins.callRpc({ pluginId: TASKS_PLUGIN_ID, method, input: input as never, outputSchema });

  let projects: { at: number; list: z.infer<typeof projectSchema>[] } | null = null;
  const listProjects = async (): Promise<z.infer<typeof projectSchema>[]> => {
    if (projects !== null && now() - projects.at < 60_000) return projects.list;
    const result = await call("listProjects", {}, z.object({ projects: z.array(projectSchema) }).loose());
    projects = { at: now(), list: result.projects };
    return result.projects;
  };

  const facts = new Map<string, { at: number; value: TaskFacts | null }>();
  const TASK_TTL_MS = 20_000;

  const getTaskByKey = async (key: string): Promise<TaskInfo | null> => {
    const result = await call("getTaskByKey", { taskKey: key }, z.object({ task: taskSchema.nullable() }).loose());
    return result.task === null ? null : toInfo(result.task);
  };

  return {
    getTaskByKey,
    async createTask(input: { trackerProjectId: string; title: string; description: string }): Promise<TaskInfo> {
      const result = await call(
        "createTask",
        { projectId: input.trackerProjectId, title: input.title, description: input.description, status: "todo" },
        mutationSchema,
      );
      return toInfo(mutationTask(result, "createTask"));
    },
    async moveTask(taskId: string, status: string): Promise<void> {
      mutationTask(await call("boardMove", { taskId, status, authorName: "chief-mode" }, mutationSchema), "boardMove");
    },
    async updateStatus(taskId: string, status: string): Promise<void> {
      mutationTask(await call("updateTask", { taskId, status, authorName: "chief-mode" }, mutationSchema), "updateTask");
    },
    async attach(taskId: string, threadId: string): Promise<void> {
      await call("taskThreadsAttach", { taskId, threadId }, z.object({ threadId: z.string() }).loose());
    },
    async listTaskThreads(taskId: string): Promise<string[]> {
      const result = await call("listTaskThreads", { taskId }, z.object({ taskThreads: z.array(z.object({ threadId: z.string() }).loose()) }).loose());
      return result.taskThreads.map((row) => row.threadId);
    },
    async trackerProjectFor(bbProjectId: string): Promise<{ id: string; prefix: string } | null> {
      const match = (await listProjects()).find((project) => project.linkedBbProjectId === bbProjectId);
      return match === undefined ? null : { id: match.id, prefix: match.prefix };
    },
    async bbProjectForTracker(trackerProjectId: string): Promise<string | null> {
      return (await listProjects()).find((project) => project.id === trackerProjectId)?.linkedBbProjectId ?? null;
    },
    /** Title and status per key, cached briefly; a failed lookup reads as unknown, not as an error. */
    async facts(keys: string[]): Promise<Map<string, TaskFacts>> {
      const out = new Map<string, TaskFacts>();
      await Promise.all(
        [...new Set(keys)].map(async (key) => {
          const cached = facts.get(key);
          let value = cached !== undefined && now() - cached.at < TASK_TTL_MS ? cached.value : undefined;
          if (value === undefined) {
            try {
              const task = await getTaskByKey(key);
              value = task === null ? null : { key: task.key, title: task.title, status: task.status };
            } catch {
              value = null;
            }
            facts.set(key, { at: now(), value });
          }
          if (value !== null) out.set(key, value);
        }),
      );
      return out;
    },
    invalidate(key?: string): void {
      if (key === undefined) facts.clear();
      else facts.delete(key);
    },
  };
}

export type TasksClient = ReturnType<typeof createTasksClient>;
