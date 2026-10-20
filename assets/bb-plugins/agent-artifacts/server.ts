// bb-plugin-agent-artifacts — the backend. Gathers what shapes one thread's agent from bb's own answers
// (bb.sdk) and the instruction files in its workspace, then serves it to the thread panel (RPC) and to
// terminals and agents (`bb artifacts`). For Claude Code threads it also asks the host entry (host.ts) for
// Claude Code's own view of the workspace. Reads only: it writes nothing and calls no model.
import { defineRpcContract, type BbPluginApi, type PluginBbSdk } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract } from "./contract";
import { buildClaudeInventory, claudeMarkdown, type ClaudeInventory } from "./lib/claude";
import {
  buildInventory,
  homeFromDataDir,
  instructionCandidates,
  inventoryMarkdown,
  type ContextRecord,
  type ExecutionOptions,
  type FileProbe,
  type Inventory,
  type PluginRecord,
  type Snapshot,
} from "./lib/inventory";

const threadInput = z.object({ threadId: z.string().min(1) });
const inventoryOutput = z.custom<Inventory>(v => typeof v === "object" && v !== null, "not an inventory");

export const rpcContract = defineRpcContract({
  /** The whole inventory for one thread. `fresh` skips the short cache (the panel's refresh button). */
  inventory: {
    input: threadInput.extend({ fresh: z.boolean().optional() }),
    output: inventoryOutput,
  },
  /**
   * Claude Code's own view of the thread's workspace (MCP servers, hooks, permissions, subagents, ...), probed on
   * the workspace's host. Null with a reason for other providers or a workspace not on disk.
   */
  claude: {
    input: threadInput.extend({ fresh: z.boolean().optional() }),
    output: z.object({
      inventory: z.custom<ClaudeInventory>(v => typeof v === "object" && v !== null, "not a Claude inventory").nullable(),
      reason: z.string().nullable(),
    }),
  },
  /** The counts the thread header chip shows, served from the same cache. */
  summary: {
    input: threadInput,
    output: z.object({
      providerName: z.string(),
      activeSkills: z.number(),
      tools: z.number(),
      instructions: z.number(),
      pluginProblems: z.number(),
    }),
  },
});

export type InventorySummary = z.infer<(typeof rpcContract)["summary"]["output"]>;

/** How long an inventory is reused: long enough that header chips and the panel share one gathering. */
const CACHE_MS = 20_000;
/** Claude Code's view is reused longer: probing starts a Claude Code process and connects its MCP servers. */
const CLAUDE_CACHE_MS = 120_000;

type Sdk = PluginBbSdk;

/** Runs one read; a failure becomes a line under Problems instead of failing the whole inventory. */
async function attempt<T>(problems: string[], label: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    problems.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function probe(sdk: Sdk, c: ReturnType<typeof instructionCandidates>[number]): Promise<FileProbe> {
  try {
    const file = await sdk.files.read({ path: c.path, ...(c.hostId === null ? {} : { hostId: c.hostId }) });
    return { ...c, exists: true, sizeBytes: file.sizeBytes };
  } catch {
    return { ...c, exists: false, sizeBytes: null };
  }
}

function pluginRecord(p: Awaited<ReturnType<Sdk["plugins"]["list"]>>["plugins"][number]): PluginRecord {
  return {
    id: p.id,
    name: p.name ?? p.id,
    description: p.description ?? null,
    enabled: p.enabled,
    status: p.status,
    statusDetail: p.statusDetail ?? null,
    provenance: p.provenance,
    version: p.version ?? null,
    icon: p.icon ?? null,
    providerIds: [...(p.providerIds ?? [])],
    capabilities: (p.capabilities ?? []).map(c => ({ kind: c.kind, id: c.id, label: c.label, detail: c.detail ?? null })),
    cliCommand: p.cliCommand ?? null,
    services: (p.services ?? []).map(s => ({ name: s.name, state: s.state })),
    schedules: [...(p.schedules ?? [])],
    hasApp: p.app?.hasApp === true,
  };
}

function contextRecord(r: Awaited<ReturnType<Sdk["threads"]["context"]>>): ContextRecord | null {
  const u = r.usage;
  if (u === null) return null;
  return {
    usedTokens: u.usedTokens,
    window: u.modelContextWindow,
    estimated: u.estimated,
    model: u.snapshot?.model ?? null,
    autoCompactAtTokens: u.snapshot?.autoCompactAtTokens ?? null,
    categories: (u.snapshot?.categories ?? []).map(c => ({
      id: c.id,
      label: c.label,
      kind: c.kind,
      tokens: c.tokens,
      entries: c.entries.map(e => ({ id: e.id, label: e.label, tokens: e.tokens })),
    })),
  };
}

async function executionOptions(sdk: Sdk, problems: string[], threadId: string, projectId: string, providerId: string): Promise<ExecutionOptions | null> {
  const own = await attempt(problems, "thread options", () => sdk.threads.defaultExecutionOptions({ threadId }));
  if (own !== null) return { model: own.model, reasoningLevel: own.reasoningLevel, permissionMode: own.permissionMode, serviceTier: own.serviceTier, from: "thread" };
  const project = await attempt(problems, "project defaults", () => sdk.projects.defaultExecutionOptions({ projectId }));
  // A project default for another provider says nothing about this thread.
  if (project === null || project.providerId !== providerId) return null;
  return { model: project.model, reasoningLevel: project.reasoningLevel, permissionMode: project.permissionMode, serviceTier: project.serviceTier, from: "project default" };
}

/** Everything the inventory is built from, read from bb for one thread. */
async function snapshot(sdk: Sdk, threadId: string): Promise<Snapshot> {
  const problems: string[] = [];
  const thread = await sdk.threads.get({ threadId });
  const { projectId, providerId, environmentId } = thread;
  const [providers, skills, plugins, context, environment, config, options] = await Promise.all([
    attempt(problems, "providers", () => sdk.providers.list()),
    attempt(problems, "skills", () => sdk.skills.list({ projectId, environmentId })),
    attempt(problems, "plugins", () => sdk.plugins.list()),
    attempt(problems, "context usage", () => sdk.threads.context({ threadId })),
    environmentId === null ? Promise.resolve(null) : attempt(problems, "environment", () => sdk.environments.get({ environmentId })),
    attempt(problems, "server config", () => sdk.system.config()),
    executionOptions(sdk, problems, threadId, projectId, providerId),
  ]);
  const dataDir = config?.dataDir ?? null;
  const serverHostId = config?.primaryHostId ?? null;
  const wsHost = environment?.hostId ?? null;
  // Home is known only when the workspace is on bb's own machine and bb keeps its data in ~/.bb.
  const home = dataDir !== null && wsHost !== null && wsHost === serverHostId ? homeFromDataDir(dataDir) : null;
  const candidates = instructionCandidates({ providerId, dataDir, serverHostId, workspace: environment?.path ?? null, workspaceHostId: wsHost, home });
  const files = await Promise.all(candidates.map(c => probe(sdk, c)));
  const provider = providers?.find(p => p.id === providerId) ?? null;
  return {
    thread: { id: thread.id, title: thread.title, providerId, projectId },
    provider: provider === null ? null : { id: provider.id, displayName: provider.displayName, available: provider.available },
    options,
    environment:
      environment === null
        ? null
        : {
            id: environment.id,
            path: environment.path,
            hostId: environment.hostId,
            branchName: environment.branchName ?? null,
            isWorktree: environment.isWorktree,
            isGitRepo: environment.isGitRepo,
            environmentProviderId: environment.environmentProviderId ?? null,
            status: environment.status,
          },
    context: context === null ? null : contextRecord(context),
    skills: (skills?.skills ?? []).map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      filePath: s.filePath,
      scope: s.scope,
      provider: s.provider,
      pluginId: s.pluginId,
    })),
    plugins: (plugins?.plugins ?? []).map(pluginRecord),
    providerNames: Object.fromEntries((providers ?? []).map(p => [p.id, p.displayName])),
    files,
    problems,
  };
}

const HELP = [
  "Usage: bb artifacts [thread-id] [--full] [--others] [--no-claude] [--json]",
  "",
  "Show what shapes a thread's agent: provider and model, instruction files,",
  "skills (bb's and the provider's own), plugin tools and plugin CLI commands.",
  "For Claude Code threads, also Claude Code's own view of the workspace:",
  "skills, subagents, slash commands, MCP servers and their status, hooks,",
  "plugins, marketplaces, CLAUDE.md files, auto memory, output style, status",
  "line, permissions and env vars (masked). Defaults to the calling thread.",
  "",
  "  --full       list every item, not only the counts per source",
  "  --others     include other providers' skills",
  "  --no-claude  skip Claude Code's own view (it starts a Claude Code process)",
  "  --json       the whole inventory as JSON",
].join("\n");

type ClaudeAnswer = { inventory: ClaudeInventory | null; reason: string | null };

export default async function plugin(bb: BbPluginApi) {
  const cache = new Map<string, { at: number; inv: Promise<Inventory> }>();

  /** The inventory for a thread, shared by every caller inside the cache window. A failed read is not kept. */
  function inventory(threadId: string, fresh = false): Promise<Inventory> {
    const hit = cache.get(threadId);
    if (!fresh && hit !== undefined && Date.now() - hit.at < CACHE_MS) return hit.inv;
    const inv = snapshot(bb.sdk, threadId).then(s => buildInventory(s, Date.now()));
    cache.set(threadId, { at: Date.now(), inv });
    inv.catch(() => cache.delete(threadId));
    return inv;
  }

  const host = bb.hosts.experimental_client({ contract: hostContract });
  const claudeCache = new Map<string, { at: number; answer: Promise<ClaudeInventory> }>();

  /** Claude Code's view of a thread's workspace, probed on the workspace's host and shared per workspace. */
  async function claude(threadId: string, fresh = false): Promise<ClaudeAnswer> {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.providerId !== "claude-code") return { inventory: null, reason: "Only Claude Code threads are probed so far." };
    if (thread.environmentId === null) return { inventory: null, reason: "The thread has no environment yet." };
    const env = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    if (env.path === null) return { inventory: null, reason: "The workspace is not on disk yet." };
    const key = `${env.hostId}:${env.path}`;
    const hit = claudeCache.get(key);
    if (!fresh && hit !== undefined && Date.now() - hit.at < CLAUDE_CACHE_MS) return { inventory: await hit.answer, reason: null };
    const cwd = env.path;
    // Through JSON once: bb's RPC refuses `undefined` fields, which the inventory's optional ones may hold.
    const answer = host.call("probeClaude", { cwd }, { hostId: env.hostId }).then(p => JSON.parse(JSON.stringify(buildClaudeInventory(p))) as ClaudeInventory);
    claudeCache.set(key, { at: Date.now(), answer });
    answer.catch(() => claudeCache.delete(key));
    return { inventory: await answer, reason: null };
  }

  bb.rpc.register(rpcContract, {
    inventory: ({ threadId, fresh }) => inventory(threadId, fresh === true),
    claude: ({ threadId, fresh }) => claude(threadId, fresh === true),
    summary: async ({ threadId }) => {
      const inv = await inventory(threadId);
      return { providerName: inv.thread.providerName, ...inv.counts };
    },
  });

  bb.cli.register({
    name: "artifacts",
    summary: "Show what shapes a thread's agent: provider, instructions, skills, plugin tools, and for Claude Code its MCP servers, hooks, permissions and more (bb artifacts [thread-id] [--full] [--others] [--no-claude] [--json])",
    async run(argv, ctx) {
      if (argv.includes("--help") || argv.includes("-h") || argv[0] === "help") return { exitCode: 0, stdout: HELP };
      const flags = new Set(argv.filter(a => a.startsWith("--")));
      const unknown = [...flags].filter(f => !["--full", "--others", "--no-claude", "--json"].includes(f));
      const positionals = argv.filter(a => !a.startsWith("--"));
      if (unknown.length > 0 || positionals.length > 1) return { exitCode: 2, stderr: `Unexpected ${[...unknown, ...positionals.slice(1)].join(" ")}\n\n${HELP}` };
      const threadId = positionals[0] ?? ctx.threadId;
      if (threadId === undefined) return { exitCode: 2, stderr: `No thread: pass a thread id, or run this inside a bb thread.\n\n${HELP}` };
      try {
        const [inv, provider] = await Promise.all([
          inventory(threadId, true),
          flags.has("--no-claude")
            ? Promise.resolve<ClaudeAnswer>({ inventory: null, reason: null })
            : claude(threadId).catch((err): ClaudeAnswer => ({ inventory: null, reason: `Could not probe Claude Code: ${err instanceof Error ? err.message : String(err)}` })),
        ]);
        if (flags.has("--json")) return { exitCode: 0, stdout: JSON.stringify({ ...inv, claude: provider.inventory }) };
        const full = flags.has("--full");
        const parts = [inventoryMarkdown(inv, { full, otherProviders: flags.has("--others") })];
        if (provider.inventory !== null) parts.push(claudeMarkdown(provider.inventory, { full }));
        else if (provider.reason !== null && inv.thread.providerId === "claude-code") parts.push(`_${provider.reason}_`);
        return { exitCode: 0, stdout: parts.join("\n\n") };
      } catch (err) {
        return { exitCode: 1, stderr: `Could not read thread ${threadId}: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  bb.onDispose(() => {
    cache.clear();
    claudeCache.clear();
  });
}
