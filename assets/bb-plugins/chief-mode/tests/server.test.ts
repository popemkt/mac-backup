// The whole plugin in bb's fake plugin host, with an in-memory bb behind the SDK and a mocked
// Tasks RPC: configure gating, the cm_* tools (refusal and the handoff flow), report-up on
// thread.idle, rebuilding the tree from metadata, and the CLI.
import { strict as assert } from "node:assert";
import { afterEach, describe, test } from "node:test";
import { createFakePluginHost, makePluginAgentConfigurationContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";

const TASK_ID = "01M6VJNJN0GC07DEPFMQGZYBZK";
const TRACKER_ID = "01M6EHPRDHBRFV8KKK0C1P859P";

type Row = { id: string; title: string; status: string; projectId: string; archivedAt: number | null; deletedAt: number | null };

function world() {
  const threads = new Map<string, Row>();
  const metadata = new Map<string, Record<string, unknown>>();
  const queued = new Map<string, { id: string }[]>();
  const tasksCalls: { method: string; input: unknown }[] = [];
  const sends: { threadId: string; text: string; senderThreadId?: string }[] = [];
  const spawns: Record<string, unknown>[] = [];
  const add = (id: string, title: string, projectId = "proj_dotfil") =>
    threads.set(id, { id, title, status: "idle", projectId, archivedAt: null, deletedAt: null });
  const listRow = (row: Row) => ({ ...row, titleFallback: null, hasPendingInteraction: false });
  const task = { id: TASK_ID, projectId: TRACKER_ID, key: "DOT-12", title: "Throwaway", description: "", status: "backlog" };
  const sdk = {
    threads: {
      getPluginMetadata: async ({ threadId }: { threadId: string }) => structuredClone(metadata.get(threadId) ?? {}),
      updatePluginMetadata: async ({ threadId, set, remove }: { threadId: string; set?: Record<string, unknown>; remove?: string[] }) => {
        const next = { ...(metadata.get(threadId) ?? {}), ...(set ?? {}) };
        for (const key of remove ?? []) delete next[key];
        metadata.set(threadId, next);
        return structuredClone(next);
      },
      experimental_listPluginMetadata: async ({ threadIds }: { threadIds: string[] }) => ({
        threads: threadIds.filter((id) => metadata.has(id) && Object.keys(metadata.get(id)!).length > 0).map((threadId) => ({ threadId, metadata: metadata.get(threadId)! })),
      }),
      list: async (args: { threadIds?: string[]; offset?: number; limit?: number }) => {
        let rows = [...threads.values()].filter((row) => row.archivedAt === null);
        if (args.threadIds !== undefined) rows = rows.filter((row) => args.threadIds!.includes(row.id));
        const offset = args.offset ?? 0;
        return rows.slice(offset, offset + (args.limit ?? 50)).map(listRow);
      },
      spawn: async (args: Record<string, unknown>) => {
        spawns.push(args);
        const id = `thr_spawned${spawns.length}`;
        add(id, String(args.title), String(args.projectId));
        queued.set(id, [{ id: `q_${id}` }]);
        return { id };
      },
      send: async (args: { threadId: string; input: { text: string }[]; senderThreadId?: string }) => {
        sends.push({ threadId: args.threadId, text: args.input[0]!.text, senderThreadId: args.senderThreadId });
        return { ok: true, delivery: "sent" };
      },
      queuedMessages: {
        list: async ({ threadId }: { threadId: string }) => queued.get(threadId) ?? [],
        send: async ({ threadId }: { threadId: string }) => {
          queued.set(threadId, []);
          return { ok: true };
        },
      },
    },
    projects: { list: async () => [{ id: "proj_dotfil", name: ".dotfiles", kind: "standard" }] },
    plugins: {
      callRpc: async ({ pluginId, method, input, outputSchema }: { pluginId: string; method: string; input: unknown; outputSchema: { parse(value: unknown): unknown } }) => {
        assert.equal(pluginId, "tasks");
        tasksCalls.push({ method, input });
        const reply = (() => {
          switch (method) {
            case "getTaskByKey":
              return { task: (input as { taskKey: string }).taskKey === "DOT-12" ? task : null };
            case "listProjects":
              return { projects: [{ id: TRACKER_ID, prefix: "DOT", linkedBbProjectId: "proj_dotfil" }] };
            case "taskThreadsAttach":
              return { threadId: (input as { threadId: string }).threadId };
            case "listTaskThreads":
              return { taskThreads: [] };
            case "boardMove":
              task.status = (input as { status: string }).status;
              return { ok: true, task };
            default:
              throw new Error(`unexpected tasks method ${method}`);
          }
        })();
        return outputSchema.parse(reply);
      },
    },
  };
  return { threads, metadata, tasksCalls, sends, spawns, add, sdk };
}

let dispose: (() => Promise<void>) | null = null;
afterEach(async () => {
  await dispose?.();
  dispose = null;
});

async function boot(settings: Record<string, unknown> = {}) {
  const w = world();
  const { bb, harness } = createFakePluginHost({
    pluginId: "chief-mode",
    settings: { debounceSeconds: 2, ...settings },
    sdk: w.sdk as never,
    agentSkillIds: ["chief-mode"],
  });
  await plugin(bb);
  dispose = () => harness.lifecycle.dispose();
  return { w, harness };
}

const text = (result: unknown): string =>
  typeof result === "string" ? result : (result as { content: { text: string }[] }).content.map((part) => part.text).join("\n");
const isError = (result: unknown): boolean => typeof result === "object" && result !== null && (result as { isError?: boolean }).isError === true;

describe("chief-mode plugin", () => {
  test("configure offers tools by role only", async () => {
    const { harness } = await boot();
    const none = await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ pluginMetadata: {} }));
    assert.deepEqual(none.tools, []);
    assert.deepEqual(none.skills, []);
    const arch = await harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext({ pluginMetadata: { role: "architect", taskKey: "DOT-12", reportsTo: "thr_chief1" } }),
    );
    assert.deepEqual(arch.tools.map((tool) => tool.name).sort(), ["cm_report_up", "cm_roster"]);
    assert.deepEqual(arch.skills, ["chief-mode"]);
    assert.match(arch.instructions ?? "", /task architect/u);
  });

  test("a tool call from a thread without the role is refused", async () => {
    const { w, harness } = await boot();
    w.add("thr_plain1", "Plain");
    const result = await harness.behavior.callAgentTool("cm_handoff", { taskKey: "DOT-12", brief: "x" }, { threadId: "thr_plain1", projectId: "proj_dotfil" });
    assert.equal(isError(result), true);
    assert.match(text(result), /cm_handoff is for a/u);
    assert.equal(w.spawns.length, 0);
  });

  test("handoff from a project chief: plain spawn, role metadata, task attach + move, brief dispatched", async () => {
    const { w, harness } = await boot();
    w.add("thr_chief1", "Chief");
    w.metadata.set("thr_chief1", { role: "project-chief", projectId: "proj_dotfil" });
    const result = await harness.behavior.callAgentTool(
      "cm_handoff",
      { taskKey: "DOT-12", brief: "Reply OK." },
      { threadId: "thr_chief1", projectId: "proj_dotfil" },
    );
    assert.equal(isError(result), false, text(result));
    assert.match(text(result), /DOT-12 → architect thread thr_spawned1/u);

    const [spawn] = w.spawns;
    assert.equal(spawn!.title, "DOT-12 — Throwaway");
    assert.equal(spawn!.origin, "sdk");
    assert.equal("pluginMetadata" in spawn!, false, "no metadata seed (it would mark the thread plugin-created)");
    assert.equal("parentThreadId" in spawn!, false, "no parent link (it cascades archive/delete)");
    assert.equal("visibility" in spawn!, false, "visible by default");
    assert.equal(typeof spawn!.sendAt, "number", "first message held until the role is written");
    assert.match(String(spawn!.prompt), /Reply OK\./u);

    assert.deepEqual(w.metadata.get("thr_spawned1"), {
      v: 1,
      role: "architect",
      projectId: "proj_dotfil",
      taskKey: "DOT-12",
      taskId: TASK_ID,
      reportsTo: "thr_chief1",
      since: (w.metadata.get("thr_spawned1") as { since: number }).since,
      autoReport: true,
    });
    const methods = w.tasksCalls.map((call) => call.method);
    assert.ok(methods.includes("taskThreadsAttach"));
    assert.deepEqual(w.tasksCalls.find((call) => call.method === "boardMove")?.input, { taskId: TASK_ID, status: "in_progress", authorName: "chief-mode" });

    const roster = text(await harness.behavior.callAgentTool("cm_roster", {}, { threadId: "thr_chief1", projectId: "proj_dotfil" }));
    assert.match(roster, /DOT-12 Throwaway \(in_progress\)/u);
    assert.match(roster, /Task architect: DOT-12 — Throwaway thr_spawned1/u);
  });

  test("thread.idle on an architect reports its final text to the chief after the debounce", async () => {
    const { w, harness } = await boot();
    w.add("thr_chief1", "Chief");
    w.add("thr_arch01", "DOT-12 — Throwaway");
    await harness.behavior.runCli(["adopt", "thr_chief1", "--role", "project-chief"]);
    await harness.behavior.runCli(["adopt", "thr_arch01", "--role", "architect", "--task", "DOT-12"]);
    assert.equal((w.metadata.get("thr_arch01") as { reportsTo: string }).reportsTo, "thr_chief1", "defaults to the project's chief");

    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "thr_arch01", title: "DOT-12 — Throwaway" }),
      lastAssistantText: "Done: all green.",
    });
    assert.equal(w.sends.length, 0, "debounced");
    await new Promise((resolve) => setTimeout(resolve, 2_300));
    assert.equal(w.sends.length, 1);
    assert.equal(w.sends[0]!.threadId, "thr_chief1");
    assert.equal(w.sends[0]!.senderThreadId, "thr_arch01");
    assert.match(w.sends[0]!.text, /^\[chief-mode report\] Task architect "DOT-12 — Throwaway" \(thr_arch01\) for DOT-12 finished a turn:\n\nDone: all green\.$/u);

    // The coordinator's own idle never reports anywhere.
    await harness.behavior.runCli(["adopt", "thr_chief1", "--role", "coordinator"]);
    await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "thr_chief1" }), lastAssistantText: "hi" });
    await new Promise((resolve) => setTimeout(resolve, 2_300));
    assert.equal(w.sends.length, 1);
  });

  test("the tree rebuilds from thread metadata alone", async () => {
    const { w, harness } = await boot();
    w.add("thr_coord1", "Coordinator");
    w.add("thr_chief1", "Chief");
    w.add("thr_other1", "Unrelated");
    w.metadata.set("thr_coord1", { role: "coordinator" });
    w.metadata.set("thr_chief1", { role: "project-chief", projectId: "proj_dotfil", reportsTo: "thr_coord1" });
    w.metadata.set("thr_other1", { something: "else" });
    const rebuilt = (await harness.behavior.callRpc("rebuild", null)) as { members: number; scanned: number };
    assert.deepEqual(rebuilt, { members: 2, scanned: 3, truncated: false });
    const roster = (await harness.behavior.callRpc("roster", { projectId: null })) as { coordinatorId: string; projects: { chiefs: { threadId: string }[] }[] };
    assert.equal(roster.coordinatorId, "thr_coord1");
    assert.equal(roster.projects[0]!.chiefs[0]!.threadId, "thr_chief1");
  });

  test("CLI: adopt refuses loops and unknown roles; drop removes only the role", async () => {
    const { w, harness } = await boot();
    w.add("thr_aaaa1", "A");
    w.add("thr_bbbb1", "B");
    assert.equal((await harness.behavior.runCli(["adopt", "thr_aaaa1", "--role", "janitor"])).exitCode !== 0, true);
    await harness.behavior.runCli(["adopt", "thr_aaaa1", "--role", "project-chief", "--reports-to", "thr_bbbb1"]);
    const loop = await harness.behavior.runCli(["adopt", "thr_bbbb1", "--role", "project-chief", "--reports-to", "thr_aaaa1"]);
    assert.notEqual(loop.exitCode, 0);
    assert.match(loop.stderr ?? "", /loop/u);
    const dropped = await harness.behavior.runCli(["drop", "thr_aaaa1"]);
    assert.equal(dropped.exitCode, 0);
    assert.deepEqual(w.metadata.get("thr_aaaa1"), {});
    assert.equal(w.threads.has("thr_aaaa1"), true, "the thread itself is untouched");
    const status = await harness.behavior.runCli(["status", "--json"]);
    assert.equal(JSON.parse(status.stdout ?? "{}").members, 0);
  });
});
