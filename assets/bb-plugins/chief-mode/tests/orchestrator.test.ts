// Delegation against a mocked bb and Tasks: the handoff writes the role before the first turn,
// attaches the thread to the task, moves the task, and never spawns a second architect by accident.
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { parseMeta, type RoleMeta } from "../core/model.ts";
import { ensureProjectChief, handoff, type HandoffInput, OrchestratorError, type OrchestratorPort, type TaskInfo } from "../core/orchestrator.ts";

const TASK: TaskInfo = {
  id: "01M6VJNJN0GC07DEPFMQGZYBZK",
  key: "DOT-12",
  title: "Throwaway",
  description: "Do the thing.",
  status: "backlog",
  trackerProjectId: "01M6EHPRDHBRFV8KKK0C1P859P",
};

function fakePort(over: Partial<OrchestratorPort> = {}, members: Record<string, string[]> = {}) {
  const log: string[] = [];
  const metas = new Map<string, RoleMeta>();
  let spawned = 0;
  const port: OrchestratorPort = {
    getTaskByKey: async (key) => (key === TASK.key ? { ...TASK } : null),
    createTask: async (input) => {
      log.push(`createTask ${input.title} in ${input.trackerProjectId}`);
      return { ...TASK, id: "01M6VJNJN0GC07DEPFMQGZYBZM", key: "DOT-13", title: input.title, status: "todo" };
    },
    trackerProjectFor: async (projectId) => (projectId === "proj_dotfil" ? { id: TASK.trackerProjectId, prefix: "DOT" } : null),
    bbProjectForTracker: async (id) => (id === TASK.trackerProjectId ? "proj_dotfil" : null),
    projectName: async () => ".dotfiles",
    findMembers: async (filter) => members[`${filter.role}:${filter.projectId ?? filter.taskKey ?? ""}`] ?? [],
    threadExists: async (id) => id.startsWith("thr_exist"),
    async spawnDeferred(request) {
      spawned += 1;
      const threadId = `thr_spawn${spawned}`;
      log.push(`spawn ${threadId} in ${request.projectId}: ${request.title}`);
      return { threadId, dispatch: async () => void log.push(`dispatch ${threadId}`) };
    },
    send: async (threadId, text, from) => void log.push(`send ${threadId} from ${from}: ${text}`),
    async writeMeta(threadId, meta) {
      metas.set(threadId, meta);
      log.push(`meta ${threadId} ${meta.role}`);
    },
    attach: async (taskId, threadId) => void log.push(`attach ${taskId} ${threadId}`),
    moveTask: async (taskId, status) => void log.push(`move ${taskId} ${status}`),
    now: () => 1_800_000_000_000,
    ...over,
  };
  return { port, log, metas };
}

const input = (over: Partial<HandoffInput> = {}): HandoffInput => ({
  taskKey: "DOT-12",
  newTask: null,
  brief: "Ship it.",
  reportsTo: "thr_chief1",
  projectId: "proj_dotfil",
  workspace: "project-default",
  providerId: null,
  model: null,
  force: false,
  ...over,
});

describe("handoff", () => {
  test("spawn → role → attach → move → dispatch, in that order", async () => {
    const { port, log, metas } = fakePort();
    const result = await handoff(port, input());
    assert.deepEqual(result, { threadId: "thr_spawn1", taskKey: "DOT-12", taskId: TASK.id, outcome: "spawned", createdTask: false, warnings: [] });
    assert.deepEqual(log, [
      "spawn thr_spawn1 in proj_dotfil: DOT-12 — Throwaway",
      "meta thr_spawn1 architect",
      `attach ${TASK.id} thr_spawn1`,
      `move ${TASK.id} in_progress`,
      "dispatch thr_spawn1",
    ]);
    const meta = parseMeta(metas.get("thr_spawn1"));
    assert.equal(meta?.taskKey, "DOT-12");
    assert.equal(meta?.taskId, TASK.id);
    assert.equal(meta?.reportsTo, "thr_chief1");
    assert.equal(meta?.projectId, "proj_dotfil");
  });

  test("an existing architect gets the brief instead of a second thread", async () => {
    const { port, log } = fakePort({}, { "architect:DOT-12": ["thr_arch01"] });
    const result = await handoff(port, input());
    assert.equal(result.outcome, "existing");
    assert.equal(result.threadId, "thr_arch01");
    assert.deepEqual(log, ["send thr_arch01 from thr_chief1: Ship it."]);
    const forced = await handoff(port, input({ force: true }));
    assert.equal(forced.outcome, "spawned");
  });

  test("creates the task in the Tasks project linked to the caller's bb project", async () => {
    const { port, log } = fakePort();
    const result = await handoff(port, input({ taskKey: null, newTask: { title: "New work", description: "" } }));
    assert.equal(result.createdTask, true);
    assert.equal(result.taskKey, "DOT-13");
    assert.equal(log[0], `createTask New work in ${TASK.trackerProjectId}`);
    // A todo task is moved to in progress too.
    assert.ok(log.some((line) => line.startsWith("move ")));
  });

  test("a task already in progress is not moved", async () => {
    const { port, log } = fakePort({ getTaskByKey: async () => ({ ...TASK, status: "in_review" }) });
    await handoff(port, input());
    assert.equal(
      log.some((line) => line.startsWith("move ")),
      false,
    );
  });

  test("attach and move failures become warnings; the architect still starts", async () => {
    const { port, log } = fakePort({
      attach: async () => {
        throw new Error("tasks down");
      },
      moveTask: async () => {
        throw new Error("nope");
      },
    });
    const result = await handoff(port, input());
    assert.equal(result.warnings.length, 2);
    assert.match(result.warnings[0]!, /bb tasks attach DOT-12 --thread thr_spawn1/u);
    assert.equal(log.at(-1), "dispatch thr_spawn1");
  });

  test("refuses bad input before touching anything", async () => {
    const { port, log } = fakePort();
    await assert.rejects(handoff(port, input({ brief: " " })), OrchestratorError);
    await assert.rejects(handoff(port, input({ taskKey: "nope" })), /task key/u);
    await assert.rejects(handoff(port, input({ taskKey: "DOT-99" })), /no task DOT-99/u);
    await assert.rejects(handoff(port, input({ taskKey: null, newTask: { title: "x", description: "" }, projectId: "proj_kbkbkb" })), /no bb Tasks project/u);
    assert.deepEqual(log, []);
  });

  test("lower-case keys are accepted", async () => {
    const { port } = fakePort();
    assert.equal((await handoff(port, input({ taskKey: "dot-12" }))).taskKey, "DOT-12");
  });
});

describe("ensureProjectChief", () => {
  const base = { projectId: "proj_dotfil", charter: null, reportsTo: "thr_coord1", adoptThreadId: null, workspace: "project-default" as const, providerId: null, model: null };

  test("returns the existing chief and forwards a charter", async () => {
    const { port, log } = fakePort({}, { "project-chief:proj_dotfil": ["thr_chief1"] });
    const result = await ensureProjectChief(port, { ...base, charter: "Do X" });
    assert.deepEqual(result, { threadId: "thr_chief1", outcome: "existing", warnings: [] });
    assert.deepEqual(log, ["send thr_chief1 from thr_coord1: Do X"]);
  });

  test("adopts a named thread", async () => {
    const { port, metas } = fakePort();
    const result = await ensureProjectChief(port, { ...base, adoptThreadId: "thr_exist1" });
    assert.equal(result.outcome, "adopted");
    assert.equal(metas.get("thr_exist1")?.role, "project-chief");
    await assert.rejects(ensureProjectChief(port, { ...base, adoptThreadId: "thr_missing" }), /no thread/u);
  });

  test("spawns with the role written before dispatch, and a custom title", async () => {
    const { port, log } = fakePort();
    const result = await ensureProjectChief(port, { ...base, title: "[chief-mode test] Chief" });
    assert.equal(result.outcome, "spawned");
    assert.deepEqual(log, ["spawn thr_spawn1 in proj_dotfil: [chief-mode test] Chief", "meta thr_spawn1 project-chief", "dispatch thr_spawn1"]);
  });
});
