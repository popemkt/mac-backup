// chief-mode's backend. The Chief hierarchy (coordinator → project chief → task architect) as an
// overlay on ordinary bb threads: a role is this plugin's metadata on a thread, nothing more.
//
//   - agent tools (cm_*), selected per thread by its role (core/gating.ts) and re-checked on call;
//   - delegation (core/orchestrator.ts): spawn or adopt a project chief; hand a bb Task to a new
//     architect thread attached to the task on the board;
//   - automatic report-up (core/reporter.ts) on `thread.idle`;
//   - the roster (core/tree.ts), served to the Chief page, `bb chief-mode roster` and cm_roster;
//   - a member index (core/members.ts) cached in kv and rebuilt from thread metadata alone.
import { type BbPluginApi, cliCommand, defineCli, defineRpcContract, PluginCliError } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createBbPort, factsOf } from "./adapter/bb.ts";
import { createTasksClient } from "./adapter/tasks.ts";
import { allows, refusal, roleInstructions, TOOLS, type ToolName, toolsFor } from "./core/gating.ts";
import { MemberIndex, rebuildMembers } from "./core/members.ts";
import { buildMeta, isProjectId, isThreadId, parseMeta, parseRole, type Role, type RoleMeta, RoleError, ROLES, wouldCycle } from "./core/model.ts";
import { ensureProjectChief, handoff, OrchestratorError, type Workspace } from "./core/orchestrator.ts";
import { createReporter, type ReportRecord } from "./core/reporter.ts";
import { buildRoster, formatRoster, type Roster, scopeRoster } from "./core/tree.ts";

export const CHANGED_CHANNEL = "chief-mode:changed";
const ROLE_ARTICLE: Record<Role, string> = { coordinator: "the coordinator", "project-chief": "a project chief", architect: "a task architect" };
const INDEX_KEY = "members";
const recordKey = (threadId: string): string => `report:${threadId}`;
const REBUILD_EVERY_MS = 10 * 60_000;
const START_REBUILD_DELAY_MS = 3_000;
const SKILL = "chief-mode";

const workspaceSchema = z.enum(["project-default", "new-worktree"]);
const roleSchema = z.enum(ROLES);

export interface RosterView extends Roster {
  generatedAt: number;
  coordinatorId: string | null;
}

const rosterView = z.custom<RosterView>((value) => typeof value === "object" && value !== null && Array.isArray((value as { projects?: unknown }).projects));

export const rpcContract = defineRpcContract({
  roster: {
    input: z.object({ projectId: z.string().nullable().default(null) }).strict(),
    output: rosterView,
  },
  adopt: {
    input: z
      .object({
        threadId: z.string().min(1).max(80),
        role: roleSchema,
        projectId: z.string().nullable().default(null),
        taskKey: z.string().nullable().default(null),
        reportsTo: z.string().nullable().default(null),
      })
      .strict(),
    output: z.object({ threadId: z.string(), role: roleSchema, warnings: z.array(z.string()) }),
  },
  drop: {
    input: z.object({ threadId: z.string().min(1).max(80) }).strict(),
    output: z.object({ removed: z.boolean() }),
  },
  messageCoordinator: {
    input: z.object({ text: z.string().trim().min(1).max(20_000) }).strict(),
    output: z.object({ threadId: z.string(), delivery: z.string() }),
  },
  createCoordinator: {
    input: z.object({ projectId: z.string().nullable().default(null), title: z.string().trim().min(1).max(200).nullable().default(null) }).strict(),
    output: z.object({ threadId: z.string() }),
  },
  rebuild: {
    input: z.null(),
    output: z.object({ members: z.number(), scanned: z.number(), truncated: z.boolean() }),
  },
});

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const toolError = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

export default function plugin(bb: BbPluginApi): void {
  const settings = bb.settings.define({
    autoReport: { type: "boolean", label: "Send a finished turn up to the thread it reports to", default: true },
    reportArchitects: { type: "boolean", label: "Report-up for task architects", default: true },
    reportProjectChiefs: { type: "boolean", label: "Report-up for project chiefs", default: true },
    debounceSeconds: {
      type: "number",
      label: "Wait this long after a thread goes idle before reporting (seconds, 2 to 600)",
      default: 20,
      experimental_schema: z.number().min(2).max(600),
    },
    maxReportsPerHour: {
      type: "number",
      label: "Automatic reports per thread per hour (1 to 60)",
      default: 8,
      experimental_schema: z.number().int().min(1).max(60),
    },
    defaultWorkspace: {
      type: "select",
      label: "Workspace for spawned threads",
      options: ["project-default", "new-worktree"],
      experimental_optionLabels: { "project-default": "The project's default", "new-worktree": "A new worktree" },
      default: "project-default",
    },
    coordinatorProject: { type: "project", label: "Project a new coordinator thread is created in (empty: Personal)" },
  });

  const index = new MemberIndex();
  let loaded = false;
  const ensureLoaded = async (): Promise<void> => {
    if (loaded) return;
    index.replace(new Map(MemberIndex.fromJSON(await bb.storage.kv.get(INDEX_KEY)).entries()));
    loaded = true;
  };
  const persist = async (): Promise<void> => {
    await bb.storage.kv.set(INDEX_KEY, index.toJSON());
  };

  let changeTimer: ReturnType<typeof setTimeout> | null = null;
  const changed = (): void => {
    if (changeTimer !== null) return;
    changeTimer = setTimeout(() => {
      changeTimer = null;
      bb.realtime.publish(CHANGED_CHANNEL, { at: Date.now() });
    }, 250);
  };

  const tasks = createTasksClient(bb);
  const port = createBbPort({ bb, tasks, index, persist, changed });

  let rebuilding: Promise<{ members: number; scanned: number; truncated: boolean }> | null = null;
  function rebuild(): Promise<{ members: number; scanned: number; truncated: boolean }> {
    // One rebuild at a time; a caller during one shares its result.
    rebuilding ??= (async () => {
      try {
        await ensureLoaded();
        index.beginRebuild();
        const result = await rebuildMembers(port.indexPort);
        index.replace(result.members);
        await persist();
        changed();
        return { members: index.size, scanned: result.scanned, truncated: result.truncated };
      } finally {
        rebuilding = null;
      }
    })();
    return rebuilding;
  }

  /** The caller's role, read fresh from metadata (the index may lag a write made elsewhere). */
  async function callerMeta(threadId: string): Promise<RoleMeta | null> {
    await ensureLoaded();
    const current = await bb.sdk.threads.getPluginMetadata({ threadId });
    // getPluginMetadata returns the namespace object itself ({} when absent).
    const meta = parseMeta(current);
    if ((meta === null) !== !index.has(threadId) || (meta !== null && index.get(threadId)?.since !== meta.since)) {
      index.set(threadId, meta);
      await persist();
      changed();
    }
    return meta;
  }

  async function resolveProjectId(input: string | null | undefined): Promise<string | null> {
    if (input === null || input === undefined || input.trim() === "") return null;
    const trimmed = input.trim();
    if (isProjectId(trimmed as unknown)) return trimmed;
    const names = await port.projectNameMap();
    const wanted = trimmed.toLowerCase().replace(/^\./u, "");
    for (const [id, name] of names) if (name.toLowerCase().replace(/^\./u, "") === wanted) return id;
    throw new OrchestratorError(`no bb project named ${JSON.stringify(trimmed)}`);
  }

  async function adopt(input: {
    threadId: string;
    role: Role;
    projectId: string | null;
    taskKey: string | null;
    reportsTo: string | null;
  }): Promise<{ threadId: string; role: Role; warnings: string[] }> {
    await ensureLoaded();
    const warnings: string[] = [];
    if (!isThreadId(input.threadId)) throw new RoleError(`not a thread id: ${input.threadId}`);
    const [row] = await port.threadRows([input.threadId]);
    if (row === undefined) throw new RoleError(`no thread ${input.threadId}`);
    let projectId = await resolveProjectId(input.projectId);
    if (projectId === null && input.role !== "coordinator") projectId = row.projectId;
    let taskId: string | null = null;
    const taskKey = input.taskKey === null ? null : input.taskKey.trim().toUpperCase();
    if (taskKey !== null) {
      const task = await tasks.getTaskByKey(taskKey);
      if (task === null) throw new RoleError(`no task ${taskKey}`);
      taskId = task.id;
    }
    let reportsTo = input.reportsTo;
    if (reportsTo === null && input.role !== "coordinator") {
      // Default links: an architect reports to its project's chief, a chief to the coordinator.
      reportsTo =
        input.role === "architect" && projectId !== null
          ? ((await port.orchestrator.findMembers({ role: "project-chief", projectId }))[0] ?? null)
          : ((await port.orchestrator.findMembers({ role: "coordinator" }))[0] ?? null);
      if (reportsTo === input.threadId) reportsTo = null;
      if (reportsTo === null) warnings.push("reports to no one: no thread above it holds a role yet (set --reports-to)");
    }
    const meta = buildMeta(input.threadId, { role: input.role, projectId, taskKey, taskId, reportsTo }, Date.now());
    if (wouldCycle(input.threadId, meta.reportsTo, index.reportsToOf)) throw new RoleError("that reportsTo would make a loop");
    await port.writeMeta(input.threadId, meta);
    if (taskId !== null) {
      try {
        const attached = await tasks.listTaskThreads(taskId);
        if (!attached.includes(input.threadId)) await tasks.attach(taskId, input.threadId);
      } catch (error) {
        warnings.push(`not attached to ${taskKey}: ${errorText(error)}`);
      }
    }
    return { threadId: input.threadId, role: input.role, warnings };
  }

  async function roster(projectId: string | null): Promise<RosterView> {
    await ensureLoaded();
    const entries = index.entries();
    const rows = await port.threadRows(entries.map(([threadId]) => threadId));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const members = entries.flatMap(([threadId, meta]) => {
      const row = byId.get(threadId);
      return row === undefined ? [] : [{ meta, thread: factsOf(row) }];
    });
    const taskKeys = members.flatMap(({ meta }) => (meta.taskKey === null ? [] : [meta.taskKey]));
    const [taskFacts, projectNames] = await Promise.all([tasks.facts(taskKeys), port.projectNameMap()]);
    const built = scopeRoster(buildRoster({ members, tasks: taskFacts, projectNames }), projectId);
    return { ...built, generatedAt: Date.now(), coordinatorId: built.coordinators[0]?.threadId ?? null };
  }

  async function coordinatorId(): Promise<string | null> {
    await ensureLoaded();
    return (await port.orchestrator.findMembers({ role: "coordinator" }))[0] ?? null;
  }

  async function createCoordinator(projectIdInput: string | null, title: string | null): Promise<string> {
    const existing = await coordinatorId();
    if (existing !== null) return existing;
    const values = await settings.get();
    let projectId = (await resolveProjectId(projectIdInput)) ?? (typeof values.coordinatorProject === "string" && values.coordinatorProject !== "" ? values.coordinatorProject : null);
    if (projectId === null) {
      const personal = (await bb.sdk.projects.list({ includePersonal: true })).find((project) => project.kind === "personal");
      if (personal === undefined) throw new OrchestratorError("no project to create the coordinator in; set the plugin's coordinatorProject setting");
      projectId = personal.id;
    }
    const spawned = await port.orchestrator.spawnDeferred({
      projectId,
      title: title ?? "Chief — coordinator",
      prompt: [
        "You are the coordinator (Chief) in the chief-mode hierarchy, over every bb project. Read the chief-mode skill first.",
        "You do not do project work yourself: stand up a project chief per project with cm_project_chief, send them work, read cm_roster, and summarize for the person.",
        "Start by reading the roster with cm_roster, then wait for instructions.",
      ].join("\n\n"),
      workspace: "project-default",
      providerId: null,
      model: null,
      onBehalfOf: null,
    });
    await port.writeMeta(spawned.threadId, buildMeta(spawned.threadId, { role: "coordinator" }, Date.now()));
    await spawned.dispatch();
    return spawned.threadId;
  }

  async function defaultWorkspace(): Promise<Workspace> {
    const value = (await settings.get()).defaultWorkspace;
    return value === "new-worktree" ? "new-worktree" : "project-default";
  }

  const reporter = createReporter({
    async settings() {
      const values = await settings.get();
      return {
        enabled: values.autoReport,
        debounceMs: Math.round(values.debounceSeconds * 1000),
        maxPerHour: values.maxReportsPerHour,
        architects: values.reportArchitects,
        projectChiefs: values.reportProjectChiefs,
      };
    },
    meta: (threadId) => callerMeta(threadId),
    async title(threadId) {
      const cached = port.titles.get(threadId);
      if (cached !== undefined) return cached;
      const [row] = await port.threadRows([threadId]);
      return row === undefined ? threadId : factsOf(row).title;
    },
    reportsToOf: (threadId) => index.reportsToOf(threadId),
    send: async (to, from, text) => void (await port.send(to, text, from)),
    loadRecord: (threadId) => bb.storage.kv.get<ReportRecord>(recordKey(threadId)).then((value) => value ?? null),
    saveRecord: (threadId, record) => bb.storage.kv.set(recordKey(threadId), record),
    now: () => Date.now(),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    log: (level, message) => bb.log[level](message),
  });

  bb.rpc.register(rpcContract, {
    roster: ({ projectId }) => roster(projectId),
    adopt: (input) => adopt(input),
    drop: async ({ threadId }) => ({ removed: await port.clearMeta(threadId) }),
    async messageCoordinator({ text }) {
      const threadId = await coordinatorId();
      if (threadId === null) throw new Error("no coordinator yet: create or adopt one first");
      return { threadId, delivery: await port.send(threadId, text, null) };
    },
    createCoordinator: async ({ projectId, title }) => ({ threadId: await createCoordinator(projectId, title) }),
    rebuild: () => rebuild(),
  });

  // ---- Agent configuration and tools -------------------------------------------------------

  bb.agents.configure((context) => {
    const meta = parseMeta(context.pluginMetadata);
    if (meta === null) return { tools: [], skills: [] };
    return {
      tools: [...toolsFor(meta.role)],
      skills: [SKILL],
      instructions: roleInstructions(meta, {
        project: meta.projectId === context.project.id ? context.project.name : null,
        reportsToTitle: meta.reportsTo === null ? null : (port.titles.get(meta.reportsTo) ?? null),
      }),
    };
  });

  /** Runs a tool body after checking the calling thread's current role carries the tool. */
  const gated =
    <P>(tool: ToolName, body: (params: P, caller: { threadId: string; projectId: string; meta: RoleMeta }) => Promise<string>) =>
    async (params: P, ctx: { threadId: string; projectId: string }) => {
      const meta = await callerMeta(ctx.threadId);
      if (meta === null || !allows(meta.role, tool)) return toolError(refusal(tool, meta));
      try {
        return await body(params, { threadId: ctx.threadId, projectId: ctx.projectId, meta });
      } catch (error) {
        return toolError(errorText(error));
      }
    };

  bb.agents.registerTool({
    name: TOOLS.projectChief,
    description:
      "Coordinator only. Return the project chief of a bb project, adopting an existing thread as it (adoptThreadId) or spawning a new ordinary thread for it, briefed with an optional charter. The chief reports to you.",
    presentation: { label: { pending: "Standing up a project chief", completed: "Stood up a project chief" } },
    parameters: z.object({
      project: z.string().min(1).describe("The bb project: its id (proj_…) or its name."),
      charter: z.string().max(20_000).optional().describe("What this chief owns and should do first; sent as a message."),
      adoptThreadId: z.string().optional().describe("Make this existing thread the project chief instead of spawning one."),
      title: z.string().max(200).optional().describe("Title for a newly spawned chief thread."),
      workspace: workspaceSchema.optional(),
    }),
    execute: gated(TOOLS.projectChief, async (params, caller) => {
      const projectId = await resolveProjectId(params.project);
      if (projectId === null) throw new OrchestratorError("name a project");
      const result = await ensureProjectChief(port.orchestrator, {
        projectId,
        charter: params.charter ?? null,
        reportsTo: caller.threadId,
        adoptThreadId: params.adoptThreadId ?? null,
        title: params.title ?? null,
        workspace: params.workspace ?? (await defaultWorkspace()),
        providerId: null,
        model: null,
      });
      const verb = { existing: "already is", adopted: "is now (adopted)", spawned: "is now (new thread)" }[result.outcome];
      return [`Project chief for ${projectId} ${verb} thread ${result.threadId}. Its final messages report here.`, ...result.warnings].join("\n");
    }),
  });

  bb.agents.registerTool({
    name: TOOLS.handoff,
    description:
      "Hand a bb Task to a task architect: spawns an ordinary thread, attaches it to the task on the board, marks it in progress, records it as reporting to you, and sends your brief. Give taskKey for an existing task, or title (+ description) to create one in your project's Tasks project. If the task already has an architect, the brief is sent to it instead (force: true spawns another).",
    presentation: { label: { pending: "Handing off to a task architect", completed: "Handed off to a task architect" } },
    parameters: z.object({
      taskKey: z.string().optional().describe("An existing task, like DOT-12."),
      title: z.string().max(300).optional().describe("Create a new task with this title (when taskKey is absent)."),
      description: z.string().max(20_000).optional(),
      brief: z.string().min(1).max(20_000).describe("Mission, acceptance criteria, constraints. The architect starts from this."),
      project: z.string().optional().describe("bb project for a new task; defaults to yours."),
      workspace: workspaceSchema.optional(),
      providerId: z.string().optional(),
      model: z.string().optional(),
      force: z.boolean().optional(),
    }),
    execute: gated(TOOLS.handoff, async (params, caller) => {
      if (params.taskKey === undefined && params.title === undefined) throw new OrchestratorError("give taskKey, or title for a new task");
      const projectId = (await resolveProjectId(params.project)) ?? caller.meta.projectId ?? caller.projectId;
      const result = await handoff(port.orchestrator, {
        taskKey: params.taskKey ?? null,
        newTask: params.taskKey === undefined && params.title !== undefined ? { title: params.title, description: params.description ?? "" } : null,
        brief: params.brief,
        reportsTo: caller.threadId,
        projectId,
        workspace: params.workspace ?? (await defaultWorkspace()),
        providerId: params.providerId ?? null,
        model: params.model ?? null,
        force: params.force ?? false,
      });
      tasks.invalidate(result.taskKey);
      const head =
        result.outcome === "existing"
          ? `${result.taskKey} already has architect ${result.threadId}; sent it your brief.`
          : `${result.createdTask ? "Created" : "Handed off"} ${result.taskKey} → architect thread ${result.threadId} (attached on the board). It reports here when it goes idle.`;
      return [head, ...result.warnings].join("\n");
    }),
  });

  bb.agents.registerTool({
    name: TOOLS.roster,
    description: "The live Chief hierarchy: coordinator, each project's chief, its tasks (key, title, status) and their architects, with each thread's live status and what waits on the person.",
    presentation: { label: { pending: "Reading the roster", completed: "Read the roster" }, suppress: true },
    parameters: z.object({ project: z.string().optional().describe("Limit to one bb project (id or name).") }),
    execute: gated(TOOLS.roster, async (params) => formatRoster(await roster(await resolveProjectId(params.project)))),
  });

  bb.agents.registerTool({
    name: TOOLS.reportUp,
    description:
      "Send a status report to the thread you report to, now. Your turn's final message is reported automatically when you go idle; use this for a report mid-turn or a different text. The automatic report of this turn then stands down.",
    presentation: { label: { pending: "Reporting up", completed: "Reported up" } },
    parameters: z.object({ text: z.string().min(1).max(20_000) }),
    execute: gated(TOOLS.reportUp, async (params, caller) => {
      const result = await reporter.manual(caller.threadId, params.text);
      if (!result.ok) throw new Error(result.reason);
      return `Reported to ${result.to}.`;
    }),
  });

  bb.agents.registerTool({
    name: TOOLS.adopt,
    description:
      "Give an existing thread a chief-mode role (coordinator, project-chief, architect) so it joins the hierarchy, reporting to you unless reportsTo says otherwise. An architect needs taskKey and is attached to that task.",
    presentation: { label: { pending: "Adopting a thread", completed: "Adopted a thread" } },
    parameters: z.object({
      threadId: z.string().min(1),
      role: roleSchema,
      project: z.string().optional(),
      taskKey: z.string().optional(),
      reportsTo: z.string().optional(),
    }),
    execute: gated(TOOLS.adopt, async (params, caller) => {
      const result = await adopt({
        threadId: params.threadId,
        role: params.role,
        projectId: params.project ?? null,
        taskKey: params.taskKey ?? null,
        reportsTo: params.role === "coordinator" ? (params.reportsTo ?? null) : (params.reportsTo ?? caller.threadId),
      });
      return [`${result.threadId} is now ${ROLE_ARTICLE[result.role]}.`, ...result.warnings].join("\n");
    }),
  });

  // ---- Events --------------------------------------------------------------------------------

  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    await ensureLoaded();
    if (!index.has(thread.id)) return;
    port.titles.set(thread.id, thread.title ?? thread.titleFallback ?? thread.id);
    changed();
    await reporter.onIdle(thread.id, lastAssistantText);
  });
  bb.events.on("thread.active", async ({ thread }) => {
    await ensureLoaded();
    if (!index.has(thread.id)) return;
    reporter.onActive(thread.id);
    changed();
  });
  for (const event of ["thread.failed", "thread.archived", "thread.unarchived"] as const) {
    bb.events.on(event, async ({ thread }) => {
      await ensureLoaded();
      if (index.has(thread.id)) changed();
    });
  }
  bb.events.on("thread.deleted", async ({ thread }) => {
    await ensureLoaded();
    if (!index.has(thread.id)) return;
    index.set(thread.id, null);
    reporter.onActive(thread.id);
    await persist();
    changed();
  });
  bb.events.on("interaction.pending", async ({ thread, interaction }) => {
    await ensureLoaded();
    if (!index.has(thread.id)) return;
    bb.log.info(`${thread.id} waits on a person (${interaction.id})`);
    changed();
  });

  // ---- Index upkeep ----------------------------------------------------------------------------

  bb.background.service("member-index", {
    async start(signal) {
      const sleep = (ms: number) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ms);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      await sleep(START_REBUILD_DELAY_MS);
      while (!signal.aborted) {
        try {
          const result = await rebuild();
          bb.log.info(`member index rebuilt: ${result.members} members from ${result.scanned} threads${result.truncated ? " (truncated)" : ""}`);
        } catch (error) {
          bb.log.warn(`member index rebuild failed: ${errorText(error)}`);
        }
        await sleep(REBUILD_EVERY_MS);
      }
    },
  });

  bb.onDispose(() => {
    reporter.dispose();
    if (changeTimer !== null) clearTimeout(changeTimer);
  });

  // ---- CLI -------------------------------------------------------------------------------------

  const cliFail = (error: unknown): never => {
    if (error instanceof PluginCliError) throw error;
    throw new PluginCliError(errorText(error), { code: error instanceof RoleError || error instanceof OrchestratorError ? "invalid" : "failed" });
  };
  const json = { type: "boolean", description: "Machine-readable JSON output" } as const;

  bb.cli.register(
    defineCli({
      name: "chief-mode",
      summary: "The Chief hierarchy over ordinary threads: roster, adopt a role, hand off a task, status",
      commands: {
        roster: cliCommand({
          summary: "Show coordinator → project chiefs → tasks → architects with live status",
          options: { project: { type: "string", description: "Only this bb project (id or name)" }, json },
          async run(input) {
            try {
              const view = await roster(await resolveProjectId(input.options.project));
              return { exitCode: 0, stdout: input.options.json ? JSON.stringify(view) : formatRoster(view) };
            } catch (error) {
              return cliFail(error);
            }
          },
        }),
        adopt: cliCommand({
          summary: "Give an existing thread a role (coordinator, project-chief, architect)",
          positionals: [{ name: "thread", description: "Thread id (thr_…); `self` means the calling thread", required: true }],
          options: {
            role: { type: "string", required: true, description: "coordinator | project-chief | architect" },
            project: { type: "string", description: "bb project (id or name); defaults to the thread's own" },
            task: { type: "string", aliases: ["task-key"], description: "Task key an architect owns (like DOT-12); attaches the thread to it" },
            "reports-to": { type: "string", description: "Thread it reports to; defaults to the project's chief or the coordinator" },
            json,
          },
          async run(input, ctx) {
            try {
              const role = parseRole(input.options.role);
              if (role === null) throw new PluginCliError(`unknown role ${JSON.stringify(input.options.role)}`, { code: "invalid", hint: "Use coordinator, project-chief or architect." });
              const threadId = input.positionals.thread === "self" ? ctx.threadId : input.positionals.thread;
              if (threadId === undefined) throw new PluginCliError("`self` needs to run inside a thread", { code: "invalid" });
              const result = await adopt({
                threadId,
                role,
                projectId: input.options.project ?? null,
                taskKey: input.options.task ?? null,
                reportsTo: input.options["reports-to"] ?? null,
              });
              const meta = index.get(result.threadId);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ ...result, meta })
                  : [`${result.threadId} is now ${ROLE_ARTICLE[result.role]}${meta?.reportsTo ? `, reporting to ${meta.reportsTo}` : ""}.`, ...result.warnings].join("\n"),
              };
            } catch (error) {
              return cliFail(error);
            }
          },
        }),
        drop: cliCommand({
          summary: "Remove a thread's role (the thread itself is untouched)",
          positionals: [{ name: "thread", description: "Thread id", required: true }],
          async run(input) {
            try {
              const removed = await port.clearMeta(input.positionals.thread);
              return { exitCode: 0, stdout: removed ? `${input.positionals.thread} left the hierarchy.` : `${input.positionals.thread} held no role.` };
            } catch (error) {
              return cliFail(error);
            }
          },
        }),
        handoff: cliCommand({
          summary: "Hand a bb Task to a new task architect thread (attached on the board)",
          positionals: [{ name: "task", description: "Task key (like DOT-12)", required: true }],
          options: {
            brief: { type: "string", required: true, stdin: true, description: "Mission, acceptance criteria, constraints" },
            from: { type: "string", aliases: ["reports-to"], description: "Thread the architect reports to; defaults to the calling thread, else the project's chief" },
            workspace: { type: "enum", values: ["project-default", "new-worktree"], description: "Where the architect works" },
            force: { type: "boolean", description: "Spawn even if the task already has an architect" },
            json,
          },
          async run(input, ctx) {
            try {
              await ensureLoaded();
              let reportsTo = input.options.from ?? null;
              if (reportsTo === null && ctx.threadId !== undefined && index.has(ctx.threadId)) reportsTo = ctx.threadId;
              const task = await tasks.getTaskByKey(input.positionals.task.trim().toUpperCase());
              const bbProject = task === null ? null : await tasks.bbProjectForTracker(task.trackerProjectId);
              if (reportsTo === null && bbProject !== null) reportsTo = (await port.orchestrator.findMembers({ role: "project-chief", projectId: bbProject }))[0] ?? null;
              const result = await handoff(port.orchestrator, {
                taskKey: input.positionals.task,
                newTask: null,
                brief: input.options.brief,
                reportsTo,
                projectId: bbProject ?? ctx.projectId ?? null,
                workspace: (input.options.workspace as Workspace | undefined) ?? (await defaultWorkspace()),
                providerId: null,
                model: null,
                force: input.options.force,
              });
              tasks.invalidate(result.taskKey);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify({ ...result, reportsTo })
                  : [
                      result.outcome === "existing"
                        ? `${result.taskKey} already has architect ${result.threadId}; sent it the brief.`
                        : `${result.taskKey} → architect ${result.threadId}, attached; reports to ${reportsTo ?? "no one"}.`,
                      ...result.warnings,
                    ].join("\n"),
              };
            } catch (error) {
              return cliFail(error);
            }
          },
        }),
        report: cliCommand({
          summary: "Report to the thread this one reports to, now (the CLI form of cm_report_up, for a thread adopted mid-session)",
          options: {
            text: { type: "string", required: true, stdin: true, description: "The report" },
            from: { type: "string", description: "Reporting thread; defaults to the calling thread" },
          },
          async run(input, ctx) {
            try {
              const threadId = input.options.from ?? ctx.threadId;
              if (threadId === undefined) throw new PluginCliError("run it inside a roled thread, or pass --from <thread>", { code: "invalid" });
              const meta = await callerMeta(threadId);
              if (meta === null || !allows(meta.role, TOOLS.reportUp)) throw new PluginCliError(refusal(TOOLS.reportUp, meta), { code: "forbidden" });
              const result = await reporter.manual(threadId, input.options.text);
              if (!result.ok) throw new PluginCliError(result.reason, { code: "invalid" });
              return { exitCode: 0, stdout: `Reported to ${result.to}.` };
            } catch (error) {
              return cliFail(error);
            }
          },
        }),
        status: cliCommand({
          summary: "The plugin's state: members by role, pending reports; --rebuild rescans thread metadata",
          options: { rebuild: { type: "boolean", description: "Rebuild the member index from thread metadata first" }, json },
          async run(input) {
            try {
              await ensureLoaded();
              const rebuilt = input.options.rebuild ? await rebuild() : null;
              const counts: Record<Role, number> = { coordinator: 0, "project-chief": 0, architect: 0 };
              for (const [, meta] of index.entries()) counts[meta.role] += 1;
              const values = await settings.get();
              const view = { members: index.size, byRole: counts, pendingReports: reporter.pendingCount(), autoReport: values.autoReport, rebuilt };
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(view)
                  : [
                      `chief-mode: ${index.size} members (${counts.coordinator} coordinator, ${counts["project-chief"]} project chiefs, ${counts.architect} architects).`,
                      `Report-up: ${values.autoReport ? `on, ${values.debounceSeconds}s debounce, ${values.maxReportsPerHour}/h cap` : "off"}; ${reporter.pendingCount()} pending.`,
                      rebuilt === null ? null : `Rebuilt from ${rebuilt.scanned} threads${rebuilt.truncated ? " (truncated)" : ""}.`,
                    ]
                      .filter((line) => line !== null)
                      .join("\n"),
              };
            } catch (error) {
              return cliFail(error);
            }
          },
        }),
      },
    }),
  );
}
