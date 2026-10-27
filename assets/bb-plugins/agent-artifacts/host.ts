// bb-plugin-agent-artifacts — the host entry. Runs on the machine a workspace lives on and asks Claude Code what it
// would load there: a session started through the Claude Agent SDK with a prompt stream that never yields, so no
// turn runs and no model is called. Hooks are switched off for it, nothing is written to its session history, and
// it is closed as soon as it has answered. The settings, plugin and MCP files are read straight from disk.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { query, type McpServerStatus, type Query } from "@anthropic-ai/claude-agent-sdk";
import { hostContract } from "./contract";
import {
  SETTINGS_SOURCES,
  endpoint,
  isPluginOn,
  isRecord,
  mergeSettings,
  strings,
  type ClaudeLive,
  type ClaudeProbe,
  type Json,
  type LiveMcp,
  type McpConfig,
  type PluginDisk,
  type SettingsSource,
} from "./lib/claude";

const INIT_TIMEOUT_MS = 12_000;
const CALL_TIMEOUT_MS = 5_000;
const MCP_WAIT_MS = 6_000;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not answer within ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>(resolve => {
    const onAbort = () => (clearTimeout(timer), resolve());
    const timer = setTimeout(() => (signal.removeEventListener("abort", onAbort), resolve()), ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

// ------------------------------------------------------------------ files

function readJson(path: string, problems: string[]): Json | null {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (isRecord(parsed)) return parsed;
    problems.push(`${path}: not a JSON object`);
  } catch (err) {
    problems.push(`${path}: ${message(err)}`);
  }
  return null;
}

function listNames(dir: string, suffix: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(e => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith(suffix))
      .map(e => e.name)
      .sort();
  } catch {
    return [];
  }
}

function mcpRecord(v: unknown): Record<string, McpConfig> {
  if (!isRecord(v)) return {};
  const servers = isRecord(v.mcpServers) ? v.mcpServers : v;
  const out: Record<string, McpConfig> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    if (!isRecord(cfg)) continue;
    out[name] = {
      type: typeof cfg.type === "string" ? cfg.type : undefined,
      command: typeof cfg.command === "string" ? cfg.command : undefined,
      url: typeof cfg.url === "string" ? cfg.url : undefined,
    };
  }
  return out;
}

/** The nearest folder at or above `cwd` holding `.git`, which Claude Code keys project state by. */
function gitRoot(cwd: string): string | null {
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

function managedSettingsDir(): string {
  if (process.platform === "darwin") return "/Library/Application Support/ClaudeCode";
  if (process.platform === "win32") return "C:\\Program Files\\ClaudeCode";
  return "/etc/claude-code";
}

type Paths = { cwd: string; roots: string[]; home: string; configDir: string; userJson: string };

function paths(cwd: string): Paths {
  const home = homedir();
  const custom = process.env.CLAUDE_CONFIG_DIR || undefined;
  const configDir = custom ?? join(home, ".claude");
  const root = gitRoot(cwd);
  return { cwd, roots: root === null || root === cwd ? [cwd] : [cwd, root], home, configDir, userJson: custom === undefined ? join(home, ".claude.json") : join(custom, ".claude.json") };
}

function readSettings(p: Paths, problems: string[]): Pick<ClaudeProbe, "settings" | "settingsPaths"> {
  const files: Record<SettingsSource, string> = {
    user: join(p.configDir, "settings.json"),
    project: join(p.cwd, ".claude", "settings.json"),
    local: join(p.cwd, ".claude", "settings.local.json"),
    policy: join(managedSettingsDir(), "managed-settings.json"),
  };
  const settings: ClaudeProbe["settings"] = {};
  const settingsPaths: ClaudeProbe["settingsPaths"] = {};
  for (const source of SETTINGS_SOURCES) {
    const json = readJson(files[source], problems);
    if (json === null) continue;
    settings[source] = json;
    settingsPaths[source] = files[source];
  }
  // Drop-in managed settings layer over managed-settings.json, in name order.
  const dropIns = join(managedSettingsDir(), "managed-settings.d");
  for (const name of listNames(dropIns, ".json")) {
    const json = readJson(join(dropIns, name), problems);
    if (json !== null) settings.policy = mergeSettings({ user: settings.policy ?? {}, policy: json });
  }
  return { settings, settingsPaths };
}

function pluginFolder(id: string, root: string, problems: string[]): PluginDisk {
  const manifest = readJson(join(root, ".claude-plugin", "plugin.json"), problems) ?? {};
  const hooksJson = isRecord(manifest.hooks)
    ? { hooks: manifest.hooks }
    : readJson(typeof manifest.hooks === "string" ? join(root, manifest.hooks) : join(root, "hooks", "hooks.json"), problems);
  const mcpJson = isRecord(manifest.mcpServers) ? { mcpServers: manifest.mcpServers } : readJson(join(root, ".mcp.json"), problems);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    name: str(manifest.name) ?? id.slice(0, id.lastIndexOf("@")),
    root,
    version: str(manifest.version),
    hooks: isRecord(hooksJson?.hooks) ? hooksJson.hooks : undefined,
    modules: Array.isArray(hooksJson?.modules) ? strings(hooksJson.modules) : undefined,
    mcp: mcpJson === null ? undefined : mcpRecord(mcpJson),
  };
}

/** Where an installed plugin lives for this workspace: a project install here, else the user install. */
function installPath(installed: Json, id: string, roots: string[]): string | null {
  const installs = Array.isArray(installed[id]) ? (installed[id] as unknown[]).filter(isRecord) : [];
  const install = installs.find(i => typeof i.projectPath === "string" && roots.includes(i.projectPath)) ?? installs.find(i => i.scope === "user") ?? installs[0];
  return typeof install?.installPath === "string" ? install.installPath : null;
}

function readDisk(p: Paths, settings: ClaudeProbe["settings"], live: ClaudeLive | null, problems: string[]): ClaudeProbe["disk"] {
  const merged = mergeSettings(settings);
  const installedFile = readJson(join(p.configDir, "plugins", "installed_plugins.json"), problems);
  const installed = isRecord(installedFile?.plugins) ? installedFile.plugins : {};
  const enabled = isRecord(merged.enabledPlugins) ? merged.enabledPlugins : {};
  const plugins: Record<string, PluginDisk> = {};
  for (const [id, on] of Object.entries(enabled)) {
    const root = isPluginOn(on) ? installPath(installed, id, p.roots) : null;
    if (root !== null && existsSync(root)) plugins[id] = pluginFolder(id, root, problems);
  }

  const userJson = readJson(p.userJson, problems) ?? {};
  const projects = isRecord(userJson.projects) ? userJson.projects : {};
  const project = (p.roots.map(r => projects[r]).find(isRecord) ?? {}) as Json;

  const styles = (dir: string, source: string) => listNames(dir, ".md").map(f => ({ name: f.slice(0, -3), source, path: join(dir, f) }));

  // The auto-memory folder: where the session loaded MEMORY.md from, else where Claude Code keeps it.
  const auto = live?.context?.memoryFiles?.find(f => f.type === "AutoMem");
  const memoryDirs = auto === undefined ? p.roots.map(r => join(p.configDir, "projects", r.replace(/[^A-Za-z0-9]/g, "-"), "memory")) : [dirname(auto.path)];
  const memoryDir = memoryDirs.find(d => existsSync(d)) ?? null;
  const memoryFiles = memoryDir === null ? [] : listNames(memoryDir, ".md");

  return {
    installed: installed as ClaudeProbe["disk"]["installed"],
    marketplaces: (readJson(join(p.configDir, "plugins", "known_marketplaces.json"), problems) ?? {}) as ClaudeProbe["disk"]["marketplaces"],
    userMcp: mcpRecord({ mcpServers: userJson.mcpServers ?? {} }),
    localMcp: mcpRecord({ mcpServers: project.mcpServers ?? {} }),
    projectMcp: mcpRecord(readJson(join(p.cwd, ".mcp.json"), problems) ?? {}),
    approvals: {
      enabled: strings(project.enabledMcpjsonServers),
      disabled: strings(project.disabledMcpjsonServers),
      enableAll: project.enableAllProjectMcpServers === true,
    },
    plugins,
    outputStyles: [...styles(join(p.configDir, "output-styles"), "user"), ...styles(join(p.cwd, ".claude", "output-styles"), "project")],
    memory: memoryDir === null || memoryFiles.length === 0 ? null : { dir: memoryDir, files: memoryFiles },
  };
}

// ------------------------------------------------------------------ the session

/** The `claude` executable on PATH (or where its installer puts it); the SDK's bundled one otherwise. */
function claudeExecutable(home: string): string | undefined {
  const dirs = [...(process.env.PATH ?? "").split(delimiter), join(home, ".local", "bin"), join(home, ".claude", "local")];
  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
  for (const dir of dirs) {
    for (const name of names) {
      const file = join(dir, name);
      try {
        if (dir !== "" && statSync(file).isFile()) return file;
      } catch {
        // not here
      }
    }
  }
  return undefined;
}

function liveMcp(m: McpServerStatus): LiveMcp {
  const cfg = (m.config ?? {}) as Json;
  const conf: McpConfig = { type: typeof cfg.type === "string" ? cfg.type : undefined, url: typeof cfg.url === "string" ? cfg.url : undefined, command: typeof cfg.command === "string" ? cfg.command : undefined };
  return {
    name: m.name,
    status: m.status,
    scope: m.scope ?? null,
    source: m.source ?? null,
    transport: conf.type ?? (conf.url === undefined ? (conf.command === undefined ? null : "stdio") : "http"),
    endpoint: endpoint(conf),
    error: m.error ?? null,
    server: m.serverInfo === undefined ? null : `${m.serverInfo.name} ${m.serverInfo.version}`,
    tools: (m.tools ?? []).map(t => ({ name: t.name, description: t.description ?? null })),
  };
}

/** Polls MCP status until no server is still connecting, or the wait is over. */
async function settledMcp(q: Query, waitMs: number, signal: AbortSignal): Promise<{ servers: McpServerStatus[]; settled: boolean }> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const servers = await withTimeout(q.mcpServerStatus(), CALL_TIMEOUT_MS, "MCP status");
    const settled = servers.every(s => s.status !== "pending");
    if (settled || Date.now() >= deadline || signal.aborted) return { servers, settled };
    await sleep(300, signal);
  }
}

async function liveSession(p: Paths, mcpWaitMs: number, signal: AbortSignal, problems: string[]): Promise<ClaudeLive | null> {
  const abort = new AbortController();
  const stop = () => abort.abort();
  signal.addEventListener("abort", stop, { once: true });
  // The prompt stream: it never yields, so the session starts, answers control requests, and runs no turn.
  async function* never(): AsyncGenerator<never> {
    await new Promise<void>(resolve => abort.signal.addEventListener("abort", () => resolve(), { once: true }));
  }
  const executable = claudeExecutable(p.home);
  let q: Query | null = null;
  try {
    q = query({
      prompt: never(),
      options: {
        cwd: p.cwd,
        abortController: abort,
        settingSources: ["user", "project", "local"],
        persistSession: false,
        settings: { disableAllHooks: true },
        ...(executable === undefined ? {} : { pathToClaudeCodeExecutable: executable }),
        stderr: () => {},
      },
    });
    const init = await withTimeout(q.initializationResult(), INIT_TIMEOUT_MS, "Claude Code");
    const [agents, mcp] = await Promise.all([
      withTimeout(q.supportedAgents(), CALL_TIMEOUT_MS, "subagents").catch(err => (problems.push(message(err)), init.agents)),
      settledMcp(q, mcpWaitMs, signal).catch(err => (problems.push(message(err)), { servers: [] as McpServerStatus[], settled: false })),
    ]);
    // After MCP settles, so connected servers' tools are counted.
    const ctx = await withTimeout(q.getContextUsage({ detail: "summary" }), CALL_TIMEOUT_MS, "context usage").catch(err => (problems.push(message(err)), null));
    const ext = init as typeof init & { current_permission_mode?: string };
    return {
      version: init.claude_code_version ?? null,
      account: init.account ?? null,
      permissionMode: typeof ext.current_permission_mode === "string" ? ext.current_permission_mode : null,
      outputStyle: init.output_style,
      outputStyles: init.available_output_styles ?? [],
      models: (init.models ?? []).map(m => ({ value: m.value, displayName: m.displayName })),
      commands: (init.commands ?? []).map(c => ({ name: c.name, description: c.description, argumentHint: c.argumentHint, builtin: c.builtin === true })),
      agents: agents.map(a => ({ name: a.name, description: a.description, model: a.model ?? null })),
      mcp: mcp.servers.map(liveMcp),
      mcpSettled: mcp.settled,
      context:
        ctx === null
          ? null
          : {
              totalTokens: ctx.totalTokens,
              maxTokens: ctx.maxTokens,
              model: ctx.model,
              autoCompactAt: ctx.autoCompactThreshold ?? null,
              categories: (ctx.categories ?? []).map(c => ({ id: c.id ?? null, name: c.name, tokens: c.tokens, kind: c.kind })),
              memoryFiles: (ctx.memoryFiles ?? []).map(f => ({ path: f.path, type: f.type, tokens: f.tokens })),
              mcpTools: (ctx.mcpTools ?? []).map(t => ({ name: t.name, serverName: t.serverName, tokens: t.tokens })),
              agents: (ctx.agents ?? []).map(a => ({ agentType: a.agentType, source: a.source, pluginId: a.pluginId ?? null, path: a.path ?? null, tokens: a.tokens })),
              skills:
                ctx.skills === undefined
                  ? null
                  : {
                      total: ctx.skills.totalSkills,
                      included: ctx.skills.includedSkills,
                      items: (ctx.skills.skillFrontmatter ?? []).map(k => ({ name: k.name, source: k.source, pluginName: k.pluginName ?? null, pluginId: k.pluginId ?? null, path: k.path ?? null, tokens: k.tokens })),
                    },
            },
    };
  } catch (err) {
    problems.push(`Claude Code session${executable === undefined ? " (no claude on PATH; used the SDK's own)" : ` (${executable})`}: ${message(err)}`);
    return null;
  } finally {
    signal.removeEventListener("abort", stop);
    abort.abort();
    try {
      q?.close();
    } catch {
      // already gone
    }
  }
}

export async function probeClaude(cwd: string, mcpWaitMs: number, signal: AbortSignal): Promise<ClaudeProbe> {
  const started = Date.now();
  const problems: string[] = [];
  if (!existsSync(cwd)) throw new Error(`${cwd} does not exist on this machine`);
  const p = paths(cwd);
  const { settings, settingsPaths } = readSettings(p, problems);
  const live = await liveSession(p, mcpWaitMs, signal, problems);
  return {
    cwd,
    home: p.home,
    configDir: p.configDir,
    live,
    settings,
    settingsPaths,
    disk: readDisk(p, settings, live, problems),
    problems,
    probedAt: Date.now(),
    probeMs: Date.now() - started,
  };
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    probeClaude: ({ cwd, mcpWaitMs }, context) => probeClaude(cwd, mcpWaitMs ?? MCP_WAIT_MS, context.signal),
  },
});
