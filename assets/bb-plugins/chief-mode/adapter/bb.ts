// chief-mode's binding to bb: the one place that turns the core's ports into SDK calls. Threads
// are spawned plain: visible, the project's own provider, no metadata seed (a seed attributes the
// thread to this plugin), no parentThreadId (it cascades archive and delete). The role is written
// afterwards with `updatePluginMetadata`.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { MemberIndex, MemberIndexPort } from "../core/members.ts";
import { metaRecord, type RoleMeta } from "../core/model.ts";
import type { OrchestratorPort, SpawnRequest } from "../core/orchestrator.ts";
import type { ThreadFacts } from "../core/tree.ts";
import type { TasksClient } from "./tasks.ts";

/** How long a spawned thread's first message is held while its role is written. */
export const SPAWN_HOLD_MS = 90_000;

export type ThreadRow = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number];

export const factsOf = (row: ThreadRow): ThreadFacts => ({
  id: row.id,
  title: row.title ?? row.titleFallback ?? row.id,
  status: row.status,
  projectId: row.projectId,
  archived: row.archivedAt !== null || row.deletedAt !== null,
  pending: row.hasPendingInteraction ? 1 : 0,
});

export function textInput(text: string) {
  return [{ type: "text" as const, text, mentions: [] }];
}

export function createBbPort(deps: {
  bb: BbPluginApi;
  tasks: TasksClient;
  index: MemberIndex;
  persist: () => Promise<void>;
  changed: () => void;
  now?: () => number;
}) {
  const { bb, tasks, index } = deps;
  const now = deps.now ?? Date.now;

  let projectNames: { at: number; names: Map<string, string> } | null = null;
  async function projectNameMap(): Promise<Map<string, string>> {
    if (projectNames !== null && now() - projectNames.at < 60_000) return projectNames.names;
    const list = await bb.sdk.projects.list({ includePersonal: true });
    projectNames = { at: now(), names: new Map(list.map((project) => [project.id, project.name])) };
    return projectNames.names;
  }

  /** Recently seen thread titles, for the synchronous configure callback and report headers. */
  const titles = new Map<string, string>();

  async function threadRows(threadIds: string[]): Promise<ThreadRow[]> {
    const rows: ThreadRow[] = [];
    for (let start = 0; start < threadIds.length; start += 200) {
      const batch = threadIds.slice(start, start + 200);
      rows.push(...(await bb.sdk.threads.list({ threadIds: batch, includeHidden: true, limit: batch.length })));
    }
    for (const row of rows) titles.set(row.id, row.title ?? row.titleFallback ?? row.id);
    return rows;
  }

  async function writeMeta(threadId: string, meta: RoleMeta): Promise<void> {
    await bb.sdk.threads.updatePluginMetadata({ threadId, set: metaRecord(meta) });
    index.set(threadId, meta);
    await deps.persist();
    deps.changed();
  }

  async function clearMeta(threadId: string): Promise<boolean> {
    const current = await bb.sdk.threads.getPluginMetadata({ threadId });
    const keys = Object.keys(current);
    if (keys.length > 0) await bb.sdk.threads.updatePluginMetadata({ threadId, remove: keys });
    const had = index.has(threadId);
    index.set(threadId, null);
    await deps.persist();
    deps.changed();
    return had || keys.length > 0;
  }

  async function send(threadId: string, text: string, from: string | null): Promise<"sent" | "queued"> {
    const result = await bb.sdk.threads.send({
      threadId,
      mode: "auto",
      input: textInput(text),
      ...(from === null ? {} : { senderThreadId: from }),
    });
    return result.delivery;
  }

  async function spawnDeferred(request: SpawnRequest): Promise<{ threadId: string; dispatch(): Promise<void> }> {
    const environment =
      request.workspace === "new-worktree"
        ? ({ type: "host", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } } as const)
        : ({ type: "project-default" } as const);
    const thread = await bb.sdk.threads.spawn({
      projectId: request.projectId,
      environment,
      title: request.title,
      prompt: request.prompt,
      // Hold the first message until the role is written (dispatch sends it at once; if dispatch
      // never runs, it still goes out when the hold ends).
      sendAt: now() + SPAWN_HOLD_MS,
      // Attribute the thread like one any SDK client spawned, not as plugin-owned.
      // (bb's `startedOnBehalfOf` would name the requesting agent, but it requires a parent or
      // source thread, which this plugin deliberately does not set; the brief names it instead.)
      origin: "sdk",
      ...(request.providerId === null ? {} : { providerId: request.providerId }),
      ...(request.model === null ? {} : { model: request.model }),
    });
    titles.set(thread.id, request.title);
    return {
      threadId: thread.id,
      async dispatch() {
        try {
          const queued = await bb.sdk.threads.queuedMessages.list({ threadId: thread.id });
          for (const row of queued) await bb.sdk.threads.queuedMessages.send({ threadId: thread.id, queuedMessageId: row.id, mode: "auto" });
        } catch (error) {
          bb.log.warn(`dispatch of ${thread.id}'s first message failed; it goes out when its hold ends: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    };
  }

  const orchestrator: OrchestratorPort = {
    getTaskByKey: (key) => tasks.getTaskByKey(key),
    createTask: (input) => tasks.createTask(input),
    trackerProjectFor: (projectId) => tasks.trackerProjectFor(projectId),
    bbProjectForTracker: (trackerId) => tasks.bbProjectForTracker(trackerId),
    projectName: async (projectId) => (await projectNameMap()).get(projectId) ?? projectId,
    async findMembers(filter) {
      const candidates = index.find(filter);
      if (candidates.length === 0) return [];
      const live = new Set((await threadRows(candidates)).filter((row) => !factsOf(row).archived).map((row) => row.id));
      return candidates.filter((id) => live.has(id));
    },
    async threadExists(threadId) {
      return (await threadRows([threadId])).length > 0;
    },
    spawnDeferred,
    send: async (threadId, text, from) => void (await send(threadId, text, from)),
    writeMeta,
    attach: (taskId, threadId) => tasks.attach(taskId, threadId),
    moveTask: (taskId, status) => tasks.moveTask(taskId, status),
    now,
  };

  const indexPort: MemberIndexPort = {
    async listThreadIds(offset, limit) {
      const rows = await bb.sdk.threads.list({ includeHidden: true, archived: false, limit, offset });
      for (const row of rows) titles.set(row.id, row.title ?? row.titleFallback ?? row.id);
      return rows.map((row) => row.id);
    },
    async listMeta(threadIds) {
      const result = await bb.sdk.threads.experimental_listPluginMetadata({ threadIds });
      return result.threads.map((row) => ({ threadId: row.threadId, metadata: row.metadata }));
    },
  };

  return { orchestrator, indexPort, threadRows, writeMeta, clearMeta, send, projectNameMap, titles };
}

export type BbPort = ReturnType<typeof createBbPort>;
