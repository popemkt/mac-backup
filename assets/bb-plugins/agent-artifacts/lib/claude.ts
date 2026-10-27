// Claude Code's own view of a workspace, as the Claude Code `agent-artifacts` mod lists it: skills, subagents,
// commands, hooks, MCP servers, plugins, marketplaces, CLAUDE.md files, auto memory, output style, status line,
// permissions and env vars. host.ts gathers a ClaudeProbe (a Claude Code session that never gets a prompt, plus
// the settings files it reads); this module turns it into groups. Pure: every rule here is tested with plain data.

export type Json = Record<string, unknown>;

/** The settings files, lowest precedence first. `policy` is managed settings. */
export const SETTINGS_SOURCES = ["user", "project", "local", "policy"] as const;
export type SettingsSource = (typeof SETTINGS_SOURCES)[number];

export type McpConfig = { type?: string; command?: string; url?: string };

/** What one enabled plugin's folder declares, read from disk. */
export type PluginDisk = {
  /** The plugin's own name, from its plugin.json (it can differ in case from the id's). */
  name: string;
  root: string;
  version?: string;
  /** hooks/hooks.json `hooks`: settings-shaped command hooks. */
  hooks?: Json;
  /** hooks/hooks.json `modules`: function-hook modules (Claude Code mods). */
  modules?: string[];
  mcp?: Record<string, McpConfig>;
};

export type McpState = "connected" | "failed" | "needs-auth" | "pending" | "disabled";

/** One MCP server as the session reports it. `endpoint` is a URL's origin or a command's program name, never its args or headers. */
export type LiveMcp = {
  name: string;
  status: McpState;
  scope: string | null;
  source: string | null;
  transport: string | null;
  endpoint: string;
  error: string | null;
  server: string | null;
  tools: { name: string; description: string | null }[];
};

/** What a Claude Code session started in the workspace reports about itself, before any prompt. */
export type ClaudeLive = {
  version: string | null;
  account: { email?: string; organization?: string; subscriptionType?: string; apiProvider?: string; tokenSource?: string; apiKeySource?: string } | null;
  permissionMode: string | null;
  outputStyle: string;
  outputStyles: string[];
  models: { value: string; displayName: string }[];
  commands: { name: string; description: string; argumentHint: string; builtin: boolean }[];
  agents: { name: string; description: string; model: string | null }[];
  mcp: LiveMcp[];
  /** False when some servers were still connecting when the probe stopped waiting. */
  mcpSettled: boolean;
  context: {
    totalTokens: number;
    maxTokens: number;
    model: string;
    autoCompactAt: number | null;
    categories: { id: string | null; name: string; tokens: number; kind: string }[];
    memoryFiles: { path: string; type: string; tokens: number }[];
    mcpTools: { name: string; serverName: string; tokens: number }[];
    agents: { agentType: string; source: string; pluginId: string | null; path: string | null; tokens: number }[];
    skills: {
      total: number;
      included: number;
      items: { name: string; source: string; pluginName: string | null; pluginId: string | null; path: string | null; tokens: number }[];
    } | null;
  } | null;
};

export type ClaudeProbe = {
  cwd: string;
  home: string;
  configDir: string;
  /** Null when the session could not start; the groups then come from disk alone. */
  live: ClaudeLive | null;
  settings: Partial<Record<SettingsSource, Json>>;
  settingsPaths: Partial<Record<SettingsSource, string>>;
  disk: {
    installed: Record<string, { scope?: string; version?: string; projectPath?: string | null }[]>;
    marketplaces: Record<string, Json>;
    userMcp: Record<string, McpConfig>;
    localMcp: Record<string, McpConfig>;
    projectMcp: Record<string, McpConfig>;
    approvals: { enabled: string[]; disabled: string[]; enableAll: boolean };
    plugins: Record<string, PluginDisk>;
    outputStyles: { name: string; source: string; path: string }[];
    memory: { dir: string; files: string[] } | null;
  };
  problems: string[];
  probedAt: number;
  probeMs: number;
};

export type KindId =
  | "skills"
  | "agents"
  | "commands"
  | "mcp"
  | "hooks"
  | "mods"
  | "plugins"
  | "marketplaces"
  | "instructions"
  | "memory"
  | "outputStyle"
  | "statusLine"
  | "permissions"
  | "env";

export type Status = "on" | "off" | "pending" | McpState | "no-tools";

export type Item = {
  /** Unique within its group. */
  id: string;
  name: string;
  /** Where it is defined: `user`, `project`, `local`, `managed`, `plugin <id>`, `built-in`, ... */
  source: string;
  detail?: string;
  /** Longer text shown when the row is opened. */
  description?: string;
  status?: Status;
  /** An env value, already masked. The value itself never leaves the server: see `envValues`. */
  masked?: string;
  /** Read from disk now, not reported by the session. */
  fromDisk?: boolean;
  /** A file on the probed host. */
  path?: string;
  /** Names it carries, such as an MCP server's tools. */
  list?: string[];
  tokens?: number;
};

export type Group = { kind: KindId; title: string; icon: string; note?: string; items: Item[] };

export type ClaudeInventory = {
  cwd: string;
  probedAt: number;
  probeMs: number;
  isLive: boolean;
  version: string | null;
  account: ClaudeLive["account"];
  baseline: { totalTokens: number; maxTokens: number; model: string } | null;
  groups: Group[];
  /** What needs a look: failed or unauthenticated MCP servers, project servers awaiting approval. */
  attention: string[];
  problems: string[];
};

export const KINDS: { kind: KindId; title: string; icon: string }[] = [
  { kind: "skills", title: "Skills", icon: "Brain" },
  { kind: "agents", title: "Subagents", icon: "AiBrain01" },
  { kind: "commands", title: "Slash commands", icon: "Terminal" },
  { kind: "mcp", title: "MCP servers", icon: "Plug02" },
  { kind: "hooks", title: "Hooks", icon: "Link" },
  { kind: "mods", title: "Mods (function hooks)", icon: "Puzzle" },
  { kind: "plugins", title: "Plugins", icon: "PackageReceive" },
  { kind: "marketplaces", title: "Marketplaces", icon: "Globe" },
  { kind: "instructions", title: "CLAUDE.md and rules", icon: "FileText" },
  { kind: "memory", title: "Auto memory", icon: "Pin" },
  { kind: "outputStyle", title: "Output style", icon: "Palette" },
  { kind: "statusLine", title: "Status line", icon: "PanelBottom" },
  { kind: "permissions", title: "Permissions", icon: "SecurityCheck" },
  { kind: "env", title: "Env vars", icon: "Lock" },
];

// ------------------------------------------------------------------ helpers

export const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const firstLine = (s: string, max = 90): string => {
  const line = s.trim().split("\n", 1)[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

export function tilde(path: string, home: string): string {
  return home !== "" && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

export function mask(value: string): string {
  return value === "" ? "(empty)" : `${"•".repeat(Math.min(8, value.length))} (${value.length} chars)`;
}

/** Where a server runs, without what can carry credentials: a URL's origin, a command's program name. */
export function endpoint(cfg: McpConfig): string {
  if (cfg.url === undefined) return (cfg.command ?? "").split("/").pop() ?? "";
  try {
    return new URL(cfg.url).origin;
  } catch {
    return "";
  }
}

const transportOf = (cfg: McpConfig) => cfg.type ?? (cfg.url === undefined ? "stdio" : "http");

/**
 * The settings sources merged as Claude Code layers them: later wins for scalars, arrays (permission rules, MCP
 * approval lists, hook entries) are concatenated without duplicates, and a few maps merge key by key.
 */
export function mergeSettings(settings: ClaudeProbe["settings"]): Json {
  const merged: Json = {};
  for (const source of SETTINGS_SOURCES) {
    const s = settings[source];
    if (s !== undefined) mergeInto(merged, s, true);
  }
  return merged;
}
const MERGED_MAPS = new Set(["enabledPlugins", "env", "extraKnownMarketplaces", "permissions", "hooks"]);

function mergeInto(target: Json, layer: Json, isTop: boolean): void {
  for (const [key, value] of Object.entries(layer)) {
    const prior = target[key];
    if (Array.isArray(prior) && Array.isArray(value)) {
      const seen = new Set(prior.map(v => JSON.stringify(v)));
      target[key] = [...prior, ...value.filter(v => !seen.has(JSON.stringify(v)))];
    } else if (isRecord(prior) && isRecord(value) && (!isTop || MERGED_MAPS.has(key))) {
      const next = { ...prior };
      mergeInto(next, value, false);
      target[key] = next;
    } else target[key] = value;
  }
}

/** An `enabledPlugins` value that turns a plugin on: `true`, a version-constraint list, or an object not disabled. */
export const isPluginOn = (v: unknown): boolean => v === true || Array.isArray(v) || (isRecord(v) && v.enabled !== false);

const labelOf = (source: SettingsSource): string => (source === "policy" ? "managed" : source);

/** The settings source a key's merged value comes from: the last one that sets it. */
function decidingSource(settings: ClaudeProbe["settings"], has: (s: Json) => boolean): string | undefined {
  let found: string | undefined;
  for (const source of SETTINGS_SOURCES) {
    const s = settings[source];
    if (s !== undefined && has(s)) found = labelOf(source);
  }
  return found;
}

/** The engine's words for where a thing was defined, as the groups label them. */
const ENGINE_SOURCES: Record<string, string> = {
  userSettings: "user",
  projectSettings: "project",
  localSettings: "local",
  policySettings: "managed",
  flagSettings: "flag",
  "built-in": "built-in",
  builtin: "built-in",
  bundled: "built-in",
  syncedSkills: "claude.ai sync",
  mcp: "mcp",
  user: "user",
  project: "project",
  local: "local",
  policy: "managed",
  managed: "managed",
  enterprise: "managed",
  claudeai: "claude.ai",
  dynamic: "dynamic",
};

const RANK = ["managed", "user", "project", "local", "flag", "plugin", "claude.ai", "mcp", "built-in"];
function rank(source: string): number {
  const at = RANK.findIndex(r => source === r || source.startsWith(`${r} `));
  return at === -1 ? RANK.length : at;
}
const byRankThenName = (a: Item, b: Item) => rank(a.source) - rank(b.source) || a.source.localeCompare(b.source) || a.name.localeCompare(b.name);

/** `name` of a plugin, as skills and agents report it, to the `name@marketplace` id settings key it by. */
export function pluginId(name: string, ids: readonly string[]): string {
  const lower = name.toLowerCase();
  return ids.find(id => id.slice(0, id.lastIndexOf("@")).toLowerCase() === lower) ?? name;
}

function group(kind: KindId, items: Item[], { note, isOrdered = false }: { note?: string; isOrdered?: boolean } = {}): Group {
  const k = KINDS.find(x => x.kind === kind)!;
  return { kind, title: k.title, icon: k.icon, note, items: isOrdered ? items : [...items].sort(byRankThenName) };
}

function enabledIds(s: ClaudeProbe, merged: Json): string[] {
  const ids = new Set<string>(Object.keys(isRecord(merged.enabledPlugins) ? merged.enabledPlugins : {}));
  for (const id of Object.keys(s.disk.plugins)) ids.add(id);
  for (const id of Object.keys(s.disk.installed)) ids.add(id);
  return [...ids];
}

// ------------------------------------------------------------------ kinds

function skills(s: ClaudeProbe, ids: string[]): Group {
  const c = s.live?.context?.skills;
  if (c === null || c === undefined) return group("skills", [], { note: s.live === null ? "Claude Code did not start, so its skills are unknown." : "The session reported no skill listing." });
  const descriptions = new Map((s.live?.commands ?? []).map(x => [x.name, x.description]));
  const items = c.items.map<Item>((k, i) => ({
    id: `${k.name}#${i}`,
    name: k.name,
    source: k.source === "plugin" ? `plugin ${k.pluginId ?? pluginId(k.pluginName ?? "", ids)}` : (ENGINE_SOURCES[k.source] ?? k.source),
    description: descriptions.get(k.name) ?? descriptions.get(k.pluginName === null ? k.name : `${k.pluginName}:${k.name}`),
    path: k.path ?? undefined,
    tokens: k.tokens,
  }));
  const unlisted = c.total - c.included;
  return group("skills", items, { note: unlisted > 0 ? `${unlisted} more skills fell outside the listing's token budget.` : undefined });
}

function agents(s: ClaudeProbe, ids: string[]): Group {
  if (s.live === null) return group("agents", [], { note: "Claude Code did not start, so its subagents are unknown." });
  const custom = new Map((s.live.context?.agents ?? []).map(a => [a.agentType, a]));
  const items = s.live.agents.map<Item>(a => {
    const c = custom.get(a.name);
    const plugin = c?.source === "plugin" ? (c.pluginId ?? pluginId(a.name.split(":")[0] ?? "", ids)) : undefined;
    const source = c === undefined ? "built-in" : plugin !== undefined ? `plugin ${plugin}` : (ENGINE_SOURCES[c.source] ?? c.source);
    return {
      id: a.name,
      name: a.name,
      source,
      detail: a.model === null ? undefined : `model ${a.model}`,
      description: a.description,
      path: c?.path ?? undefined,
      tokens: c?.tokens,
    };
  });
  return group("agents", items);
}

/** A command's source, from its name: Claude Code's own, a plugin's (`plugin:name`), an MCP prompt, or the user's. */
function commandSource(c: ClaudeLive["commands"][number], ids: string[]): string {
  if (c.builtin) return "built-in";
  if (c.name.startsWith("mcp__")) return "mcp";
  const colon = c.name.indexOf(":");
  if (colon > 0) return `plugin ${pluginId(c.name.slice(0, colon), ids)}`;
  return "custom";
}

function commands(s: ClaudeProbe, ids: string[]): Group {
  if (s.live === null) return group("commands", [], { note: "Claude Code did not start, so its commands are unknown." });
  const skillNames = new Set((s.live.context?.skills?.items ?? []).flatMap(k => [k.name, k.pluginName === null ? k.name : `${k.pluginName}:${k.name}`]));
  const items = s.live.commands
    .filter(c => !skillNames.has(c.name))
    .map<Item>(c => ({
      id: `/${c.name}`,
      name: `/${c.name}`,
      source: commandSource(c, ids),
      detail: c.argumentHint === "" ? undefined : c.argumentHint,
      description: c.description,
    }));
  return group("commands", items, { note: "Skills that also run as /commands are listed under Skills." });
}

// --- MCP

type Configured = { name: string; source: string; cfg: McpConfig; gate?: Status };

/** Whether a project .mcp.json server may start: disabled, approved, or awaiting approval. */
function projectGate(s: ClaudeProbe, merged: Json): (name: string) => Status | undefined {
  const disabled = new Set([...strings(merged.disabledMcpjsonServers), ...s.disk.approvals.disabled]);
  const enabled = new Set([...strings(merged.enabledMcpjsonServers), ...s.disk.approvals.enabled]);
  const enableAll = merged.enableAllProjectMcpServers === true || s.disk.approvals.enableAll;
  return name => (disabled.has(name) ? "disabled" : enableAll || enabled.has(name) ? undefined : "pending");
}

/** Every server a file configures, named as the session names it (`plugin:<plugin>:<server>` for a plugin's). */
export function configuredServers(s: ClaudeProbe, merged: Json): Configured[] {
  const of = (servers: Record<string, McpConfig>, source: string) => Object.entries(servers).map(([name, cfg]) => ({ name, source, cfg }));
  const gate = projectGate(s, merged);
  return [
    ...of(s.disk.userMcp, "user"),
    ...of(s.disk.localMcp, "local"),
    ...of(s.disk.projectMcp, "project").map(c => ({ ...c, gate: gate(c.name) })),
    ...Object.entries(s.disk.plugins).flatMap(([id, p]) =>
      Object.entries(p.mcp ?? {}).map(([name, cfg]) => ({ name: `plugin:${p.name}:${name}`, source: `plugin ${id}`, cfg })),
    ),
  ];
}

/** A live server's source: its plugin, its config scope, or claude.ai. */
function liveSource(m: LiveMcp, ids: string[]): string {
  if (m.source === "plugin" || m.name.startsWith("plugin:")) {
    const plugin = m.name.split(":")[1];
    return plugin === undefined ? "plugin" : `plugin ${pluginId(plugin, ids)}`;
  }
  const word = m.source ?? m.scope ?? "";
  return ENGINE_SOURCES[word] ?? (word === "" ? "other" : word);
}

function mcp(s: ClaudeProbe, merged: Json, ids: string[]): Group {
  const configured = configuredServers(s, merged);
  if (s.live === null) {
    const items = configured.map<Item>(c => ({
      id: c.name,
      name: c.name,
      source: c.source,
      status: c.gate,
      detail: `${transportOf(c.cfg)} ${endpoint(c.cfg)}`.trim(),
      fromDisk: true,
    }));
    return group("mcp", items, { note: "Read from config files only: Claude Code did not start, so connection state is unknown." });
  }
  const toolTokens = new Map<string, number>();
  for (const t of s.live.context?.mcpTools ?? []) toolTokens.set(t.serverName, (toolTokens.get(t.serverName) ?? 0) + t.tokens);
  const items: Item[] = s.live.mcp.map(m => {
    const tools = m.tools.length;
    const where = [m.transport, m.endpoint].filter(x => x !== null && x !== "").join(" ");
    // The state itself is the row's status chip; the detail says what the server is and offers.
    const parts = [where, m.server, m.status === "connected" ? `${tools} tool${tools === 1 ? "" : "s"}` : null].filter(x => x !== null && x !== "");
    return {
      id: m.name,
      name: m.name.startsWith("plugin:") ? m.name.split(":").slice(2).join(":") || m.name : m.name,
      source: liveSource(m, ids),
      status: m.status,
      detail: parts.join(" · "),
      description: m.error ?? undefined,
      list: m.tools.length === 0 ? undefined : m.tools.map(t => t.name),
      tokens: toolTokens.get(m.name.replace(/[^A-Za-z0-9_-]/g, "_")) ?? toolTokens.get(m.name),
    };
  });
  // Project servers awaiting approval do not start, so the session does not list them.
  const live = new Set(s.live.mcp.map(m => m.name));
  for (const c of configured) {
    if (live.has(c.name) || c.gate === undefined) continue;
    items.push({
      id: c.name,
      name: c.name,
      source: c.source,
      status: c.gate,
      detail: `${transportOf(c.cfg)} ${endpoint(c.cfg)} · ${c.gate === "pending" ? "awaiting approval" : "disabled for this project"}`,
      fromDisk: true,
    });
  }
  const note = s.live.mcpSettled ? undefined : "Some servers were still connecting when the probe stopped waiting; refresh to check again.";
  return group("mcp", items, { note });
}

// --- hooks and mods

type HookEntry = { matcher?: unknown; hooks?: unknown };

/** One item per hook of a settings-shaped `hooks` map: `[matcher] type: first line of its command`. */
function hookItems(hooks: unknown, source: string, fromDisk: boolean): Item[] {
  if (!isRecord(hooks)) return [];
  return Object.entries(hooks).flatMap(([event, entries]) =>
    (Array.isArray(entries) ? (entries.filter(isRecord) as HookEntry[]) : []).flatMap((entry, e) => {
      const matcher = typeof entry.matcher === "string" && entry.matcher !== "" ? `[${entry.matcher}] ` : "";
      const list = Array.isArray(entry.hooks) ? entry.hooks.filter(isRecord) : [];
      return list.map<Item>((h, i) => {
        const type = typeof h.type === "string" ? h.type : "hook";
        const body = [h.command, h.url, h.prompt].find((v): v is string => typeof v === "string") ?? "";
        return {
          id: `${source}:${event}:${e}:${i}`,
          name: event,
          source,
          detail: `${matcher}${type}: ${firstLine(body, 70)}`,
          description: body.length > 70 || body.includes("\n") ? body : undefined,
          fromDisk: fromDisk || undefined,
        };
      });
    }),
  );
}

function hooks(s: ClaudeProbe, merged: Json): Group {
  const items: Item[] = [];
  for (const source of SETTINGS_SOURCES) items.push(...hookItems(s.settings[source]?.hooks, labelOf(source), false));
  for (const [id, p] of Object.entries(s.disk.plugins)) items.push(...hookItems(p.hooks, `plugin ${id}`, true));
  const off = merged.disableAllHooks === true ? "disableAllHooks is set: none of these run. " : "";
  return group("hooks", items, { note: `${off}Command, HTTP and prompt hooks from settings files and enabled plugins' hooks.json.`, isOrdered: false });
}

function mods(s: ClaudeProbe): Group {
  const items = Object.entries(s.disk.plugins)
    .filter(([, p]) => p.modules !== undefined && p.modules.length > 0)
    .map<Item>(([id, p]) => ({ id, name: p.name, source: `plugin ${id}`, detail: `modules: ${(p.modules ?? []).join(", ")}`, fromDisk: true }));
  return group("mods", items, { note: "Plugins that ship function-hook modules (Claude Code mods)." });
}

// --- plugins and marketplaces

/** installed_plugins.json entries for one plugin, tolerating older or hand-edited shapes. */
const installsOf = (s: ClaudeProbe, id: string) => {
  const v: unknown = s.disk.installed[id];
  return (Array.isArray(v) ? v.filter(isRecord) : []) as ClaudeProbe["disk"]["installed"][string];
};

function plugins(s: ClaudeProbe, merged: Json): Group {
  const named = isRecord(merged.enabledPlugins) ? merged.enabledPlugins : {};
  const items: Item[] = Object.entries(named).map(([id, on]) => {
    const installs = installsOf(s, id);
    const version = s.disk.plugins[id]?.version ?? installs[0]?.version;
    return {
      id,
      name: id,
      source: decidingSource(s.settings, x => isRecord(x.enabledPlugins) && id in x.enabledPlugins) ?? "user",
      status: isPluginOn(on) ? "on" : "off",
      detail: installs.length === 0 ? "not installed" : version === undefined ? "installed" : `v${version}`,
      path: s.disk.plugins[id]?.root,
    };
  });
  for (const id of Object.keys(s.disk.installed)) {
    if (id in named) continue;
    const installs = installsOf(s, id);
    const here = installs.find(i => i.scope === "user" || i.projectPath === s.cwd);
    if (here === undefined) continue;
    items.push({ id, name: id, source: here.scope ?? "user", status: "off", detail: "installed, not in enabledPlugins", fromDisk: true });
  }
  return group("plugins", items, { note: "Enabled state is the merged settings; versions come from installed_plugins.json and plugin.json." });
}

function describeSource(source: unknown): string {
  if (!isRecord(source)) return "";
  for (const key of ["repo", "path", "url", "package"]) if (typeof source[key] === "string") return `${String(source.source ?? "")} ${String(source[key])}`.trim();
  return typeof source.source === "string" ? source.source : "";
}

function marketplaces(s: ClaudeProbe): Group {
  const items: Item[] = [];
  const declared = new Set<string>();
  for (const source of SETTINGS_SOURCES) {
    const extra = s.settings[source]?.extraKnownMarketplaces;
    if (!isRecord(extra)) continue;
    for (const [name, v] of Object.entries(extra)) {
      declared.add(name);
      items.push({ id: `${source}:${name}`, name, source: labelOf(source), detail: describeSource(isRecord(v) ? v.source : undefined) });
    }
  }
  for (const [name, v] of Object.entries(s.disk.marketplaces)) {
    if (declared.has(name)) continue;
    items.push({ id: `installed:${name}`, name, source: "installed", detail: describeSource(isRecord(v) ? v.source : undefined), fromDisk: true });
  }
  return group("marketplaces", items);
}

// --- files

const MEMORY_TYPES: Record<string, string> = { User: "user", Project: "project", Local: "local", Managed: "managed", Policy: "managed" };

function instructions(s: ClaudeProbe): Group {
  const files = (s.live?.context?.memoryFiles ?? []).filter(f => f.type !== "AutoMem");
  const items = files.map<Item>(f => ({
    id: f.path,
    name: tilde(f.path, s.home),
    source: MEMORY_TYPES[f.type] ?? f.type.toLowerCase(),
    path: f.path,
    tokens: f.tokens,
  }));
  const note = s.live === null ? "Claude Code did not start, so the files it loads are unknown." : "Loaded at startup, in load order. Nested CLAUDE.md files and path-scoped rules join as the agent reads files.";
  return group("instructions", items, { note, isOrdered: true });
}

function memory(s: ClaudeProbe): Group {
  const auto = (s.live?.context?.memoryFiles ?? []).filter(f => f.type === "AutoMem");
  const items: Item[] = auto.map(f => ({ id: f.path, name: tilde(f.path, s.home), source: "auto memory", detail: "in context", status: "on", path: f.path, tokens: f.tokens }));
  const loaded = new Set(auto.map(f => f.path));
  if (s.disk.memory !== null) {
    for (const file of s.disk.memory.files) {
      const path = `${s.disk.memory.dir}/${file}`;
      if (!loaded.has(path)) items.push({ id: path, name: tilde(path, s.home), source: "auto memory", detail: "read on demand", path, fromDisk: true });
    }
  }
  return group("memory", items, { note: auto.length === 0 && items.length > 0 ? "No MEMORY.md is in context at startup." : undefined, isOrdered: true });
}

function outputStyle(s: ClaudeProbe, merged: Json): Group {
  const active = s.live?.outputStyle ?? (typeof merged.outputStyle === "string" ? merged.outputStyle : "default");
  const source = decidingSource(s.settings, x => typeof x.outputStyle === "string") ?? "built-in";
  const files = new Map(s.disk.outputStyles.map(o => [o.name, o]));
  const items: Item[] = [{ id: active, name: active, source, status: "on", detail: "active", path: files.get(active)?.path }];
  const names = new Set([active]);
  for (const name of s.live?.outputStyles ?? []) {
    if (names.has(name)) continue;
    names.add(name);
    const file = files.get(name);
    items.push({ id: name, name, source: file?.source ?? "built-in", status: "off", path: file?.path });
  }
  for (const o of s.disk.outputStyles) {
    if (names.has(o.name)) continue;
    names.add(o.name);
    items.push({ id: o.name, name: o.name, source: o.source, status: "off", path: o.path, fromDisk: true });
  }
  return group("outputStyle", items, { isOrdered: true });
}

function statusLine(s: ClaudeProbe, merged: Json): Group {
  const line = merged.statusLine;
  if (!isRecord(line)) return group("statusLine", [], { note: "None configured." });
  const source = decidingSource(s.settings, x => isRecord(x.statusLine)) ?? "user";
  const body = typeof line.command === "string" ? line.command : "";
  return group("statusLine", [
    { id: "statusLine", name: typeof line.type === "string" ? line.type : "statusLine", source, detail: firstLine(body, 70), description: body.length > 70 ? body : undefined, status: "on" },
  ]);
}

/** One settings source's permission rules, deny before ask before allow, as the engine weighs them. */
function permissionItems(settings: Json, source: string): Item[] {
  const p = isRecord(settings.permissions) ? settings.permissions : {};
  const item = (name: string, detail: string): Item => ({ id: `${source}:${detail}:${name}`, name, source, detail });
  return [
    ...(["deny", "ask", "allow"] as const).flatMap(verdict => strings(p[verdict]).map(rule => item(rule, verdict))),
    ...strings(settings.allowedTools).map(rule => item(rule, "allow (legacy allowedTools)")),
    ...(typeof p.defaultMode === "string" ? [item(`defaultMode ${p.defaultMode}`, "mode")] : []),
    ...strings(p.additionalDirectories).map(dir => item(dir, "additional directory")),
  ];
}

function permissions(s: ClaudeProbe): Group {
  const items = SETTINGS_SOURCES.flatMap(from => {
    const settings = s.settings[from];
    return settings === undefined ? [] : permissionItems(settings, labelOf(from));
  });
  const mode = s.live?.permissionMode;
  const note = mode === null || mode === undefined ? undefined : `A fresh session starts in ${mode} mode; bb sets this thread's own mode.`;
  return group("permissions", items, { note, isOrdered: true });
}

/** The env vars the settings files set, keyed by the env group's item ids. Kept on the server; only revealed on request. */
export function envValues(s: Pick<ClaudeProbe, "settings">): Map<string, { name: string; from: SettingsSource; value: string }> {
  const out = new Map<string, { name: string; from: SettingsSource; value: string }>();
  for (const from of SETTINGS_SOURCES) {
    const vars = s.settings[from]?.env;
    if (!isRecord(vars)) continue;
    for (const [name, value] of Object.entries(vars)) out.set(`${from}:${name}`, { name, from, value: String(value) });
  }
  return out;
}

function env(s: ClaudeProbe): Group {
  const items: Item[] = [...envValues(s)].map(([id, v]) => ({ id, name: v.name, source: labelOf(v.from), masked: mask(v.value) }));
  return group("env", items, { note: "From settings files only, not the shell. Values stay masked until revealed." });
}

// ------------------------------------------------------------------ the inventory

/** Failed servers first, then those waiting on sign-in, then project servers waiting on approval. */
function attention(groups: Group[]): string[] {
  const items = groups.find(g => g.kind === "mcp")?.items ?? [];
  return [
    ...items.filter(i => i.status === "failed").map(i => `MCP ${i.name} failed${i.description === undefined ? "" : `: ${firstLine(i.description, 120)}`}`),
    ...items.filter(i => i.status === "needs-auth").map(i => `MCP ${i.name} needs sign-in (/mcp in Claude Code)`),
    ...items.filter(i => i.status === "pending" && i.fromDisk === true).map(i => `MCP ${i.name} in .mcp.json is awaiting approval`),
  ];
}

export function buildClaudeInventory(s: ClaudeProbe): ClaudeInventory {
  const merged = mergeSettings(s.settings);
  const ids = enabledIds(s, merged);
  const groups = [
    skills(s, ids),
    agents(s, ids),
    commands(s, ids),
    mcp(s, merged, ids),
    hooks(s, merged),
    mods(s),
    plugins(s, merged),
    marketplaces(s),
    instructions(s),
    memory(s),
    outputStyle(s, merged),
    statusLine(s, merged),
    permissions(s),
    env(s),
  ].filter(g => g.kind !== "mods" || g.items.length > 0);
  const ctx = s.live?.context ?? null;
  return {
    cwd: s.cwd,
    probedAt: s.probedAt,
    probeMs: s.probeMs,
    isLive: s.live !== null,
    version: s.live?.version ?? null,
    account: s.live?.account ?? null,
    baseline: ctx === null ? null : { totalTokens: ctx.totalTokens, maxTokens: ctx.maxTokens, model: ctx.model },
    groups,
    attention: attention(groups),
    problems: s.problems,
  };
}

/** A group's items cut into runs of one source, in the group's order. */
export function bySource(items: Item[]): { source: string; items: Item[] }[] {
  const out: { source: string; items: Item[] }[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last !== undefined && last.source === item.source) last.items.push(item);
    else out.push({ source: item.source, items: [item] });
  }
  return out;
}

export function itemMatches(item: Item, query: string): boolean {
  if (query === "") return true;
  const q = query.toLowerCase();
  return [item.name, item.source, item.detail, item.description, item.status].some(t => t !== undefined && t.toLowerCase().includes(q));
}

/** Claude Code's groups as Markdown: counts per source, or every item with `full`. Env values stay masked. */
export function claudeMarkdown(inv: ClaudeInventory, { full = false }: { full?: boolean } = {}): string {
  const lines = [`## Claude Code${inv.version === null ? "" : ` ${inv.version}`} in ${inv.cwd}`];
  if (!inv.isLive) lines.push("", "Claude Code did not start: groups below come from config files only.");
  if (inv.baseline !== null) lines.push("", `Startup context: ${inv.baseline.totalTokens} of ${inv.baseline.maxTokens} tokens (${inv.baseline.model})`);
  for (const g of inv.groups) {
    lines.push("", `### ${g.title} (${g.items.length})`);
    if (g.note !== undefined) lines.push(`_${g.note}_`);
    for (const run of bySource(g.items)) {
      if (!full) {
        lines.push(`- ${run.source}: ${run.items.length}`);
        continue;
      }
      for (const i of run.items) {
        const extra = [i.status, i.masked ?? i.detail, i.tokens === undefined ? undefined : `${i.tokens} tok`].filter(x => x !== undefined && x !== "");
        lines.push(`- ${i.name} (${i.source})${extra.length === 0 ? "" : `: ${extra.join(" · ")}`}`);
      }
    }
  }
  if (inv.attention.length > 0) lines.push("", "### Needs attention", ...inv.attention.map(a => `- ${a}`));
  if (inv.problems.length > 0) lines.push("", "### Problems", ...inv.problems.map(p => `- ${p}`));
  return lines.join("\n");
}
