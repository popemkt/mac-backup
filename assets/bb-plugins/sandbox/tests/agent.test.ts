// AgentSpecs: expansion and validation, the trajectory mapping, and one whole run through the real
// local provider with a scripted thread standing in for the agent.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { type ThreadsApi, createRunner, parseReward } from "../core/agent/runner.ts";
import { expandSpec, expandSpecText } from "../core/agent/spec-file.ts";
import { ATIF_VERSION, toTrajectory } from "../core/agent/trajectory.ts";
import { policySchema } from "../core/policy.ts";
import { createProviders } from "../core/providers/index.ts";
import { createService, memoryStore } from "../core/service.ts";

const scratch = await mkdtemp(join(tmpdir(), "sandbox-agent-"));
after(() => rm(scratch, { recursive: true, force: true }));

/** A repo with monuments/{hue,hanoi,saigon}/README.md on main. */
async function repo(): Promise<string> {
  const dir = await mkdtemp(join(scratch, "repo-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
  git("init", "-q", "-b", "main");
  for (const city of ["hue", "hanoi", "saigon"]) {
    await mkdir(join(dir, "monuments", city), { recursive: true });
    await writeFile(join(dir, "monuments", city, "README.md"), `# ${city}\n`);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  return dir;
}

const base = (repoPath: string) => ({
  schema: "bb-sandbox/agent-spec@1",
  name: "describe-${city}",
  matrix: { city: ["hue", "hanoi"] },
  agent: { harness: "claude-code", model: "claude-sonnet-5-5" },
  instructions: { prompt: "Describe ${city}." },
  workspace: { git: { repo: repoPath, ref: "main" } },
});

test("a matrix fans out into named, labelled runs with the values substituted", async () => {
  const dir = await repo();
  const specs = await expandSpec(base(dir), "/");
  assert.deepEqual(specs.map((s) => s.name), ["describe-hue", "describe-hanoi"]);
  assert.equal(specs[1].instructions.prompt, "Describe hanoi.");
  assert.equal(specs[1].labels.city, "hanoi");
  assert.equal(specs[0].sandbox.network.egress, "none", "defaults apply");
});

test("a dirs matrix makes one run per directory in the repo at the ref", async () => {
  const dir = await repo();
  const specs = await expandSpec({ ...base(dir), matrix: { city: { dirs: "monuments" } } }, "/");
  assert.deepEqual(specs.map((s) => s.labels.city).sort(), ["hanoi", "hue", "saigon"]);
});

test("YAML files resolve their paths from the file's directory", async () => {
  const dir = await repo();
  await writeFile(join(dir, "prompt.md"), "Do it.\n");
  const yaml = [
    "schema: bb-sandbox/agent-spec@1",
    "name: one",
    "agent: { harness: codex, model: gpt-5.5 }",
    "instructions: { promptFile: prompt.md, guides: [{ file: monuments/hue/README.md, as: style.md }] }",
    "workspace: { git: { repo: . } }",
  ].join("\n");
  const [spec] = await expandSpecText(yaml, join(dir, "specs.yaml"));
  assert.equal(spec.workspace.git.repo, dir);
  assert.equal(spec.instructions.promptFile, join(dir, "prompt.md"));
  assert.deepEqual(spec.instructions.guides, [{ file: join(dir, "monuments/hue/README.md"), as: "style.md" }]);
});

test("refuses Fable models, duplicate names, and a prompt given twice or not at all", async () => {
  const dir = await repo();
  await assert.rejects(expandSpec({ ...base(dir), agent: { harness: "claude-code", model: "claude-fable-5-1" } }, "/"), /Fable/);
  await assert.rejects(expandSpec({ ...base(dir), name: "same" }, "/"), /two runs are named same/);
  await assert.rejects(expandSpec({ ...base(dir), instructions: {} }, "/"), /exactly one of prompt, promptFile/);
  await assert.rejects(expandSpec({ ...base(dir), instructions: { prompt: "a", promptFile: "b" } }, "/"), /exactly one/);
});

test("an eval sensor's reward is its last line", () => {
  assert.equal(parseReward('log\n{"reward": 0.75}\n'), 0.75);
  assert.equal(parseReward("no reward"), undefined);
  assert.equal(parseReward('{"reward": "high"}'), undefined);
});

test("thread events map to ATIF steps and totals", () => {
  const t = toTrajectory(
    [
      { type: "client/turn/requested", createdAt: 1, data: { input: [{ type: "text", text: "Fix it" }] } },
      { type: "item/completed", createdAt: 2, data: { item: { type: "reasoning", id: "r", summary: ["thinking"], content: [] } } },
      { type: "item/completed", createdAt: 3, data: { item: { type: "commandExecution", id: "c1", command: "ls", cwd: "/w", aggregatedOutput: "a\n", exitCode: 0, status: "completed" } } },
      { type: "item/completed", createdAt: 4, data: { item: { type: "toolCall", id: "t1", tool: "sandbox_exec", arguments: { id: "sb-1" }, result: "ok", status: "completed" } } },
      { type: "item/completed", createdAt: 5, data: { item: { type: "agentMessage", id: "m", text: "done", parentToolCallId: "sub" } } },
      { type: "item/completed", createdAt: 6, data: { item: { type: "agentMessage", id: "m2", text: "Done." } } },
      { type: "thread/tokenUsage/updated", createdAt: 7, data: { tokenUsage: { total: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 50 } } } },
    ],
    { sessionId: "thr_1", harness: "claude-code", model: "claude-sonnet-5-5" },
  );
  assert.equal(t.schema_version, ATIF_VERSION);
  assert.deepEqual(t.steps.map((s) => s.source), ["user", "agent", "agent", "agent", "agent"]);
  assert.equal(t.steps[1].reasoning_content, "thinking");
  assert.deepEqual(t.steps[2].tool_calls, [{ tool_call_id: "c1", function_name: "shell", arguments: { command: "ls", cwd: "/w" } }]);
  assert.equal(t.steps[2].observation?.results[0].content, "a\n");
  assert.equal(t.steps[3].tool_calls?.[0].function_name, "sandbox_exec");
  assert.equal(t.steps[4].message, "Done.");
  assert.deepEqual(t.final_metrics, { total_prompt_tokens: 100, total_completion_tokens: 20, total_cached_tokens: 50, total_steps: 5 });
});

const bwrap = process.env.BWRAP ?? (() => {
  try {
    return execFileSync("sh", ["-c", "command -v bwrap"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
})();

test("a whole run: sandbox, agent thread, sensors, branch, patch, artifacts, trajectory", { skip: existsSync(bwrap) ? false : "no bubblewrap" }, async () => {
  const dir = await repo();
  await writeFile(join(dir, "guide.md"), "Be brief.\n");
  const root = await mkdtemp(join(scratch, "state-"));
  const policy = policySchema.parse({ bwrap: { path: bwrap } });
  const service = createService({ providers: createProviders(policy, root), policy, store: memoryStore() });

  const spawned: Array<{ path: string; prompt: string; parentThreadId?: string; model: string }> = [];
  const threads: ThreadsApi = {
    async spawn(args) {
      const path = args.environment.workspace.path;
      spawned.push({ path, prompt: args.prompt, parentThreadId: args.parentThreadId, model: args.model });
      // The "agent": commits one file and leaves another uncommitted.
      await writeFile(join(path, "monuments/hue/summary.md"), "Imperial city.\n");
      const git = (...a: string[]) => execFileSync("git", ["-C", path, "-c", "user.email=a@a", "-c", "user.name=a", ...a]);
      git("add", "monuments/hue/summary.md");
      git("commit", "-q", "-m", "hue summary");
      await writeFile(join(path, "notes.txt"), "left over\n");
      return { id: "thr_agent" };
    },
    async wait() {
      return {};
    },
    async stop() {
      return {};
    },
    events: {
      async list() {
        return [
          { seq: 1, type: "client/turn/requested", createdAt: 1, data: { input: [{ type: "text", text: "go" }] } },
          { seq: 2, type: "item/completed", createdAt: 2, data: { item: { type: "agentMessage", id: "m", text: "Done." } } },
        ];
      },
    },
  };
  const runner = createRunner({ service, threads, store: memoryStore(), root });
  const [spec] = await expandSpec(
    {
      schema: "bb-sandbox/agent-spec@1",
      name: "hue",
      agent: { harness: "claude-code", model: "claude-sonnet-5-5" },
      instructions: { prompt: "Summarise Hue.", guides: [{ file: "guide.md" }] },
      sensors: [
        { name: "exists", run: ["test", "-f", "monuments/hue/summary.md"], artifacts: ["monuments/hue/*.md"] },
        { name: "score", kind: "eval", run: ["sh", "-c", 'echo scoring; echo \'{"reward": 0.5}\''] },
        { name: "fails", run: ["sh", "-c", "exit 1"] },
      ],
      workspace: { git: { repo: ".", ref: "main" } },
    },
    dir,
  );
  const [queued] = await runner.submit([spec], { projectId: "proj_1", threadId: "thr_coordinator" }, "test");
  let record = await runner.get(queued.id);
  for (let i = 0; i < 200 && !["done", "failed", "cancelled"].includes(record.state); i++) {
    await new Promise((r) => setTimeout(r, 100));
    record = await runner.get(queued.id);
  }
  assert.equal(record.state, "done", record.error);

  assert.equal(spawned[0].parentThreadId, "thr_coordinator");
  assert.match(spawned[0].prompt, /Summarise Hue\.[\s\S]*\.agent\/guide\.md[\s\S]*bb sandbox exec sb-/);
  assert.deepEqual(record.sensors?.map((s) => [s.name, s.passed]), [["exists", true], ["score", true], ["fails", false]]);
  assert.equal(record.reward, 0.5);

  const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
  assert.equal(record.branch?.name, `sandbox/${record.batch}/hue`);
  assert.equal(git("show", `${record.branch?.name}:monuments/hue/summary.md`), "Imperial city.");
  assert.equal(git("worktree", "list").split("\n").length, 1, "the worktree is gone");

  const patch = await readFile(join(record.dir, "patch.diff"), "utf8");
  assert.match(patch, /notes\.txt/);
  assert.doesNotMatch(patch, /\.agent/, "guides stay out of the patch");
  assert.ok(existsSync(join(record.dir, "artifacts/exists/monuments/hue/summary.md")));
  const trajectory = JSON.parse(await readFile(join(record.dir, "trajectory.json"), "utf8"));
  assert.equal(trajectory.schema_version, ATIF_VERSION);
  assert.equal(trajectory.extra.reward, 0.5);
  assert.equal(service.status().queue.running, 0);
});
