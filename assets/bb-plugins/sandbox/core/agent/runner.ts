// The AgentSpec runner, step (a) of docs/research/2026-10-31-sandboxes.md §10: the agent (the
// builder) runs as a bb thread on the host, in the sandbox's git worktree; the sandbox holds the
// workspace, runs the sensors under its caps and policy, and its admission is the batch's queue.
// One run:
//
//   1. queue a sandbox whose workspace is the spec's repo at its ref, on the run's branch
//   2. put the guides in the workspace's .agent/ (git-ignored)
//   3. spawn the thread (harness, model, effort) with the brief, as a child of the coordinator
//   4. wait for its turn to finish, or stop it at the agent timeout
//   5. run the sensors in the sandbox; an eval sensor's last line is {"reward": <number>}
//   6. keep the artifacts, the uncommitted changes as patch.diff, the events and the trajectory
//   7. destroy the sandbox: the worktree goes, the branch with the agent's commits stays
//
// Everything a run keeps is under <root>/runs/<batch>/<name>/, and its record (state, branch,
// sensor results, reward, tokens) is queryable through the `agent` ops.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFile, glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import type { Outcome } from "../contract.ts";
import type { SandboxService, Store } from "../service.ts";
import type { AgentSpec, Sensor } from "../spec.ts";
import { type EventRow, toTrajectory } from "./trajectory.ts";

const run = promisify(execFile);

/** The slice of bb.sdk.threads the runner uses. */
export interface ThreadsApi {
  spawn(args: {
    projectId: string;
    environment: { type: "host"; workspace: { type: "unmanaged"; path: string } };
    providerId: string;
    model: string;
    reasoningLevel?: string;
    prompt: string;
    parentThreadId?: string;
    pluginMetadata?: Record<string, string>;
    title?: string;
  }): Promise<{ id: string }>;
  wait(args: { threadId: string; event?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<unknown>;
  stop(args: { threadId: string }): Promise<unknown>;
  events: {
    list(args: { threadId: string; afterSeq?: string; limit?: string; order?: "asc" | "desc" }): Promise<
      Array<{ seq: number; type: string; createdAt: number; data: unknown }>
    >;
  };
}

export type RunState = "queued" | "running" | "sensing" | "done" | "failed" | "cancelled";

export interface SensorResult {
  name: string;
  kind: Sensor["kind"];
  exitCode: number;
  passed: boolean;
  timedOut: boolean;
  durationMs: number;
  reward?: number;
  /** The last lines of its output. */
  tail: string;
  artifacts: string[];
}

export interface RunRecord {
  id: string;
  batch: string;
  name: string;
  state: RunState;
  spec: AgentSpec;
  /** Where everything the run keeps is written. */
  dir: string;
  sandboxId?: string;
  threadId?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  agentTimedOut?: boolean;
  branch?: Outcome["branch"];
  patchBytes?: number;
  sensors?: SensorResult[];
  /** The mean of the eval sensors' rewards, when there are any. */
  reward?: number;
  tokens?: { input: number; output: number; cached: number };
  error?: string;
}

export interface RunnerOptions {
  service: SandboxService;
  threads: ThreadsApi;
  store: Store;
  /** State root; runs are kept under <root>/runs. */
  root: string;
  now?: () => number;
}

/** Who started the batch: the coordinator thread and its project. */
export interface Caller {
  projectId: string;
  threadId?: string;
}

const KEY = (id: string) => `run/${id}`;
const TERMINAL: RunState[] = ["done", "failed", "cancelled"];
const slug = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "run";

/** The reward on an eval sensor's last line, or undefined. */
export function parseReward(stdout: string): number | undefined {
  const last = stdout.trimEnd().split("\n").at(-1) ?? "";
  try {
    const reward = (JSON.parse(last) as { reward?: unknown }).reward;
    return typeof reward === "number" && Number.isFinite(reward) ? reward : undefined;
  } catch {
    return undefined;
  }
}

/** What the agent is told besides its prompt: where it is and how it will be judged. */
export function brief(spec: AgentSpec, prompt: string, branch: string, guides: string[], sandboxId: string): string {
  const lines = [
    prompt.trim(),
    "",
    "---",
    `You are running unattended as sandbox run "${spec.name}". Your workspace is a git worktree on branch \`${branch}\`.`,
    "Commit your work to this branch; do not push, and do not switch branches. Nobody will answer questions: decide and note your assumptions in the commit message.",
  ];
  if (guides.length > 0) lines.push(`Read these guides first: ${guides.map((g) => `\`${g}\``).join(", ")}.`);
  if (spec.sensors.length > 0) {
    lines.push(
      `When you finish, these checks run in sandbox ${sandboxId}, which sees this workspace at /workspace. Run them there yourself first with \`bb sandbox exec ${sandboxId} -- <command>\` (or the sandbox_exec tool):`,
    );
    for (const s of spec.sensors) lines.push(`- ${s.name} (${s.kind}): \`${s.run.join(" ")}\``);
  }
  return lines.join("\n");
}

export function createRunner(options: RunnerOptions) {
  const { service, threads, store } = options;
  const now = options.now ?? Date.now;
  const controllers = new Map<string, AbortController>();

  const save = (record: RunRecord) => store.set(KEY(record.id), record);
  const load = async (id: string) => {
    const record = await store.get<RunRecord>(KEY(id));
    if (!record) throw new Error(`no run ${id}`);
    return record;
  };

  const git = async (cwd: string, args: string[]) => (await run("git", ["-C", cwd, ...args], { maxBuffer: 64 * 1024 * 1024 })).stdout;

  /** Copy files matching `patterns` (relative to the workspace) into `into`; returns what was kept. */
  const collect = async (workspace: string, patterns: string[], into: string): Promise<string[]> => {
    const kept: string[] = [];
    for (const pattern of patterns) {
      for await (const match of glob(pattern, { cwd: workspace, exclude: (p) => p === ".git" || p.startsWith(".git/") })) {
        const rel = relative(workspace, join(workspace, match));
        if (rel.startsWith("..")) continue;
        await mkdir(dirname(join(into, rel)), { recursive: true });
        await copyFile(join(workspace, rel), join(into, rel)).catch(() => {});
        kept.push(rel);
        if (kept.length >= 1000) return kept;
      }
    }
    return kept;
  };

  const writeEvents = async (record: RunRecord): Promise<EventRow[]> => {
    if (!record.threadId) return [];
    const events: EventRow[] = [];
    let afterSeq: string | undefined;
    for (;;) {
      const page = await threads.events.list({ threadId: record.threadId, afterSeq, limit: "500", order: "asc" });
      events.push(...page);
      if (page.length < 500) break;
      afterSeq = String(page.at(-1)?.seq);
    }
    await writeFile(join(record.dir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));
    return events;
  };

  async function execute(record: RunRecord, caller: Caller, signal: AbortSignal): Promise<void> {
    const { spec } = record;
    const branch = spec.outputs.branch ?? `sandbox/${record.batch}/${slug(spec.name)}`;
    const sensing = spec.sensors.reduce((sum, s) => sum + s.timeoutSec, 0);
    const box = await service.create({
      ...spec.sandbox,
      workspace: { git: { repo: spec.workspace.git.repo, ref: spec.workspace.git.ref, branch, subdir: spec.workspace.git.subdir } },
      // The sandbox lives as long as the agent and the sensors may take, plus slack.
      timeoutSec: Math.min(86400, Math.max(spec.sandbox.timeoutSec, spec.agent.timeoutSec + sensing + 600)),
      labels: { ...spec.labels, batch: record.batch, run: record.id },
      priority: spec.priority,
    });
    record.sandboxId = box.id;
    if (box.state !== "running") throw new Error(`sandbox ${box.id} ${box.state}: ${box.error ?? ""}`);
    try {
      const workspace = await service.hostWorkspace(box.id);
      if (!workspace) throw new Error(`provider ${box.provider} keeps no host workspace; step (a) runs need one`);

      // 2. Guides, outside what git sees.
      const guides: string[] = [];
      const agentDir = join(workspace, ".agent");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, ".gitignore"), "*\n");
      for (const guide of spec.instructions.guides) {
        if ("skill" in guide) {
          guides.push(`the ${guide.skill} skill`);
        } else {
          const name = guide.as ?? basename(guide.file);
          await copyFile(guide.file, join(agentDir, name));
          guides.push(`.agent/${name}`);
        }
      }

      // 3. The thread.
      const prompt = spec.instructions.prompt ?? (await readFile(spec.instructions.promptFile as string, "utf8"));
      const thread = await threads.spawn({
        projectId: caller.projectId,
        environment: { type: "host", workspace: { type: "unmanaged", path: workspace } },
        providerId: spec.agent.harness,
        model: spec.agent.model,
        ...(spec.agent.effort ? { reasoningLevel: spec.agent.effort } : {}),
        prompt: brief(spec, prompt, branch, guides, box.id),
        ...(caller.threadId ? { parentThreadId: caller.threadId } : {}),
        pluginMetadata: { sandboxId: box.id, runId: record.id },
        title: `sandbox: ${spec.name}`,
      });
      record.threadId = thread.id;
      record.state = "running";
      record.startedAt = now();
      await save(record);

      // 4. Its turn, bounded.
      try {
        await threads.wait({ threadId: thread.id, event: "turn/completed", timeoutMs: spec.agent.timeoutSec * 1000, signal });
      } catch (error) {
        if (signal.aborted) throw error;
        record.agentTimedOut = true;
      }
      if (record.agentTimedOut || signal.aborted) await threads.stop({ threadId: thread.id }).catch(() => {});

      // 5. Sensors, in the sandbox.
      record.state = "sensing";
      await save(record);
      record.sensors = [];
      for (const sensor of spec.sensors) {
        if (signal.aborted) break;
        const result = await service.exec(box.id, { argv: sensor.run, timeoutSec: sensor.timeoutSec }, signal);
        const reward = sensor.kind === "eval" ? parseReward(result.stdout) : undefined;
        record.sensors.push({
          name: sensor.name,
          kind: sensor.kind,
          exitCode: result.exitCode,
          passed: result.exitCode === 0 && !result.timedOut,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
          ...(reward !== undefined ? { reward } : {}),
          tail: `${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-20).join("\n"),
          artifacts: await collect(workspace, sensor.artifacts, join(record.dir, "artifacts", sensor.name)),
        });
      }
      const rewards = record.sensors.flatMap((s) => (s.reward === undefined ? [] : [s.reward]));
      if (rewards.length > 0) record.reward = rewards.reduce((a, b) => a + b, 0) / rewards.length;
      await writeFile(join(record.dir, "sensors.json"), JSON.stringify(record.sensors, null, 2));

      // 6. What it made.
      await collect(workspace, spec.outputs.artifacts, join(record.dir, "artifacts", "outputs"));
      await git(workspace, ["add", "-A"]);
      const patch = await git(workspace, ["diff", "--cached", "--binary", "HEAD"]);
      record.patchBytes = Buffer.byteLength(patch);
      if (patch) await writeFile(join(record.dir, "patch.diff"), patch);
    } finally {
      // 7. The branch stays.
      const destroyed = await service.destroy(box.id);
      record.branch = destroyed.outcome?.branch;
    }
  }

  async function finish(record: RunRecord): Promise<void> {
    try {
      const events = await writeEvents(record);
      const trajectory = toTrajectory(events, {
        sessionId: record.threadId ?? record.id,
        harness: record.spec.agent.harness,
        model: record.spec.agent.model,
        extra: { batch: record.batch, run: record.name, branch: record.branch ?? null, sensors: record.sensors ?? [], reward: record.reward ?? null },
      });
      await writeFile(join(record.dir, "trajectory.json"), JSON.stringify(trajectory, null, 2));
      const m = trajectory.final_metrics;
      record.tokens = { input: m.total_prompt_tokens, output: m.total_completion_tokens, cached: m.total_cached_tokens };
    } catch (error) {
      record.error = [record.error, `trajectory: ${(error as Error).message}`].filter(Boolean).join("; ");
    }
    record.endedAt = now();
    await save(record);
  }

  async function runOne(record: RunRecord, caller: Caller): Promise<void> {
    const abort = new AbortController();
    controllers.set(record.id, abort);
    try {
      await mkdir(record.dir, { recursive: true });
      await writeFile(join(record.dir, "spec.json"), JSON.stringify(record.spec, null, 2));
      await execute(record, caller, abort.signal);
      record.state = abort.signal.aborted ? "cancelled" : "done";
    } catch (error) {
      record.state = abort.signal.aborted ? "cancelled" : "failed";
      record.error = (error as Error).message;
    } finally {
      controllers.delete(record.id);
      await finish(record);
    }
  }

  const runner = {
    /** Record every run of a batch and start them; each waits in the sandbox queue. */
    async submit(specs: AgentSpec[], caller: Caller, batchName?: string): Promise<RunRecord[]> {
      const batch = `${slug(batchName ?? specs[0]?.name ?? "batch")}-${randomBytes(3).toString("hex")}`;
      const records: RunRecord[] = specs.map((spec) => ({
        id: `run-${randomBytes(5).toString("hex")}`,
        batch,
        name: spec.name,
        state: "queued",
        spec,
        dir: join(options.root, "runs", batch, slug(spec.name)),
        createdAt: now(),
      }));
      for (const record of records) await save(record);
      for (const record of records) void runOne(record, caller);
      return records;
    },

    get: load,

    async list(filter: { batch?: string; state?: RunState } = {}): Promise<RunRecord[]> {
      const records = [];
      for (const key of await store.list("run/")) {
        const record = await store.get<RunRecord>(key);
        if (!record) continue;
        if (filter.batch && record.batch !== filter.batch) continue;
        if (filter.state && record.state !== filter.state) continue;
        records.push(record);
      }
      return records.sort((a, b) => a.createdAt - b.createdAt);
    },

    /** Cancel one run, or every unfinished run of a batch. */
    async cancel(target: { runId?: string; batch?: string }): Promise<string[]> {
      const ids = target.runId
        ? [target.runId]
        : (await runner.list({ batch: target.batch })).filter((r) => !TERMINAL.includes(r.state)).map((r) => r.id);
      const cancelled = [];
      for (const id of ids) {
        const controller = controllers.get(id);
        if (!controller) continue;
        controller.abort();
        const record = await load(id);
        // A queued run is still waiting in service.create; destroying its sandbox releases it.
        if (record.sandboxId) await service.destroy(record.sandboxId, "run cancelled").catch(() => {});
        else for (const box of await service.list({ label: { run: id } })) await service.destroy(box.id, "run cancelled");
        cancelled.push(id);
      }
      return cancelled;
    },

    /** After a load: runs that were in flight lost their runner; stop their threads and fail them. */
    async reconcile(): Promise<void> {
      for (const record of await runner.list()) {
        if (TERMINAL.includes(record.state) || controllers.has(record.id)) continue;
        if (record.threadId) await threads.stop({ threadId: record.threadId }).catch(() => {});
        for (const box of await service.list({ label: { run: record.id } })) {
          const destroyed = await service.destroy(box.id, "its run was lost on reload");
          record.branch ??= destroyed.outcome?.branch;
        }
        record.state = "failed";
        record.error = "the plugin reloaded while the run was in flight";
        record.endedAt = now();
        await save(record);
      }
    },
  };
  return runner;
}

export type Runner = ReturnType<typeof createRunner>;
