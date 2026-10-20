// The inventory of what shapes one bb thread's agent, built from a snapshot of bb's own answers (gathered by
// server.ts through bb.sdk). Pure: no SDK, no I/O, so every rule here is tested with plain data. Shared by the
// server (which builds it) and the app (which only imports its types).

// ------------------------------------------------------------------ snapshot: what server.ts gathers

/** One skill as `bb.sdk.skills.list` reports it. */
export type SkillRecord = {
  id: string;
  name: string;
  description: string | null;
  filePath: string;
  scope: SkillScope;
  provider: string | null;
  pluginId: string | null;
};

export type SkillScope =
  | "bb-builtin"
  | "bb-user"
  | "bb-project"
  | "provider-user"
  | "provider-project"
  | "shared-user"
  | "shared-project"
  | "plugin";

/** One plugin capability as `bb.sdk.plugins.list` reports it. */
export type CapabilityRecord = { kind: string; id: string; label: string; detail: string | null };

/** One plugin as `bb.sdk.plugins.list` reports it (only the fields the inventory reads). */
export type PluginRecord = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  status: string;
  statusDetail: string | null;
  provenance: string;
  version: string | null;
  icon: string | null;
  providerIds: string[];
  capabilities: CapabilityRecord[];
  cliCommand: { name: string; summary: string } | null;
  services: { name: string; state: string }[];
  schedules: unknown[];
  hasApp: boolean;
};

/** A candidate file the server looked for, and whether it was there. */
export type FileProbe = Candidate & { exists: boolean; sizeBytes: number | null };

export type ExecutionOptions = {
  model: string;
  reasoningLevel: string;
  permissionMode: string;
  serviceTier: string;
  /** Where these options came from: the thread's own resolved options, or the project's defaults. */
  from: "thread" | "project default";
};

/** A slice of the context window, as the provider's last context snapshot reports it. */
export type ContextCategory = {
  id: string;
  label: string;
  kind: "used" | "free" | "reserved" | "deferred";
  tokens: number;
  entries: { id: string; label: string; tokens: number }[];
};

/** `bb.sdk.threads.context`: the usage, and the provider's breakdown when it reported one. */
export type ContextRecord = {
  usedTokens: number;
  window: number;
  estimated: boolean;
  /** The model the provider's last snapshot names; null without a snapshot. */
  model: string | null;
  autoCompactAtTokens: number | null;
  categories: ContextCategory[];
};

export type Snapshot = {
  thread: { id: string; title: string | null; providerId: string; projectId: string };
  provider: { id: string; displayName: string; available: boolean } | null;
  options: ExecutionOptions | null;
  environment: {
    id: string;
    /** Null while the environment has no workspace on disk yet. */
    path: string | null;
    hostId: string;
    branchName: string | null;
    isWorktree: boolean;
    isGitRepo: boolean;
    environmentProviderId: string | null;
    status: string;
  } | null;
  context: ContextRecord | null;
  skills: SkillRecord[];
  plugins: PluginRecord[];
  /** Every provider id bb knows, mapped to its display name, to label other providers' skills. */
  providerNames: Record<string, string>;
  files: FileProbe[];
  problems: string[];
};

// ------------------------------------------------------------------ inventory: what the panel and CLI show

/** How a skill stands for this thread. */
export type SkillStatus =
  /** Reaches this thread's agent. */
  | "active"
  /** A higher-precedence skill of the same name, in the same tier, replaces it. */
  | "shadowed"
  /** Two skills of one name in one bb source: bb drops both. */
  | "collision"
  /** Belongs to another provider: listed for comparison only. */
  | "other-provider";

/** Who injects a skill: bb itself (every provider), or the thread's provider natively. */
export type Tier = "bb" | "provider" | "other-provider";

export type Skill = {
  id: string;
  name: string;
  description: string;
  /** Human label of where it is defined, e.g. `bb plugin workflows`, `Claude Code user`. */
  source: string;
  scope: SkillScope;
  tier: Tier;
  status: SkillStatus;
  /** The source that wins over it, when `shadowed`. */
  shadowedBy?: string;
  /** Other sources, in the other tier, that define the same name. bb cannot say which one the agent prefers. */
  alsoIn?: string[];
  filePath: string;
};

export type Tool = { name: string; detail: string; pluginId: string; pluginName: string };
export type CliCommand = { command: string; summary: string; pluginId: string; pluginName: string };

/** A plugin's health as the panel colors it. */
export type Health = "ok" | "warning" | "error" | "off";

export type Plugin = {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  version: string | null;
  provenance: string;
  status: string;
  statusDetail: string | null;
  health: Health;
  /** Whether this plugin is the provider running this thread. */
  isThreadProvider: boolean;
  /** Whether it reaches the agent at all: tools, skills, a CLI command or a thread integration. */
  reachesAgent: boolean;
  tools: string[];
  skills: string[];
  integrations: string[];
  cli: string | null;
  services: { name: string; state: string }[];
  scheduleCount: number;
  hasApp: boolean;
};

export type InstructionKind = "bb-user" | "bb-workspace" | "provider" | "env-hook";

export type Instruction = {
  /** What the file is, e.g. `bb user instructions`. */
  label: string;
  kind: InstructionKind;
  path: string;
  hostId: string | null;
  sizeBytes: number | null;
  /** Rough tokens, from the size (4 bytes a token). */
  approxTokens: number | null;
  note?: string;
};

export type Inventory = {
  builtAt: number;
  thread: {
    id: string;
    title: string | null;
    providerId: string;
    providerName: string;
    providerAvailable: boolean;
    options: ExecutionOptions | null;
    /** The model in use: the resolved options', else the one the provider's last context snapshot names. */
    model: string | null;
  };
  environment: Snapshot["environment"];
  context: (ContextRecord & { ratio: number }) | null;
  instructions: Instruction[];
  /** The candidate files looked for and not found, so an absence reads as checked, not unknown. */
  missingInstructions: string[];
  skills: Skill[];
  tools: Tool[];
  cliCommands: CliCommand[];
  plugins: Plugin[];
  counts: { activeSkills: number; tools: number; cliCommands: number; instructions: number; pluginProblems: number };
  problems: string[];
};

// ------------------------------------------------------------------ candidates the server probes

export type Candidate = { label: string; kind: InstructionKind; path: string; hostId: string | null; note?: string };

/**
 * The instruction and hook files to look for in a thread's workspace, in the order they are applied. bb's own
 * files apply to every provider; the provider-native ones are what that provider reads itself (bb guide
 * agent-configuration). `home` is known only when the workspace is on bb's own machine.
 */
export function instructionCandidates(input: {
  providerId: string;
  dataDir: string | null;
  serverHostId: string | null;
  workspace: string | null;
  workspaceHostId: string | null;
  home: string | null;
}): Candidate[] {
  const { providerId, dataDir, serverHostId, workspace: ws, workspaceHostId: wsHost, home } = input;
  const out: Candidate[] = [];
  if (dataDir !== null) {
    out.push({ label: "bb user instructions", kind: "bb-user", path: `${dataDir}/AGENTS.md`, hostId: serverHostId, note: "appended for every provider" });
  }
  if (ws !== null) {
    out.push({ label: "bb workspace instructions", kind: "bb-workspace", path: `${ws}/.bb/AGENTS.md`, hostId: wsHost, note: "appended for every provider" });
  }
  const native = (path: string, label: string, note?: string) => out.push({ label, kind: "provider", path, hostId: wsHost, note });
  if (providerId === "claude-code") {
    if (home !== null) native(`${home}/.claude/CLAUDE.md`, "Claude Code user memory");
    if (ws !== null) {
      native(`${ws}/CLAUDE.md`, "Claude Code project memory");
      native(`${ws}/.claude/CLAUDE.md`, "Claude Code project memory");
      native(`${ws}/CLAUDE.local.md`, "Claude Code local memory");
      native(`${ws}/AGENTS.md`, "AGENTS.md", "Claude Code reads it when no CLAUDE.md takes precedence");
    }
  } else if (providerId === "codex") {
    if (home !== null) native(`${home}/.codex/AGENTS.md`, "Codex user instructions");
    if (ws !== null) native(`${ws}/AGENTS.md`, "Codex project instructions");
  } else if (ws !== null) {
    native(`${ws}/AGENTS.md`, "AGENTS.md", "read natively by most agents");
  }
  if (ws !== null) {
    out.push({ label: "environment setup hook", kind: "env-hook", path: `${ws}/.bb-env-setup.sh`, hostId: wsHost, note: "runs when bb creates a worktree" });
    out.push({ label: "environment teardown hook", kind: "env-hook", path: `${ws}/.bb-env-teardown.sh`, hostId: wsHost, note: "runs when bb removes a worktree" });
  }
  return out;
}

/** The home directory bb's data dir sits in, when it is the default `~/.bb`. */
export function homeFromDataDir(dataDir: string): string | null {
  return dataDir.endsWith("/.bb") ? dataDir.slice(0, -"/.bb".length) : null;
}

// ------------------------------------------------------------------ skills

const firstLine = (s: string | null, max = 160): string => {
  const line = (s ?? "").trim().split("\n", 1)[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

function providerLabel(id: string | null, names: Record<string, string>): string {
  if (id === null) return "bb";
  return names[id] ?? id;
}

/** Where a skill is defined, as the panel labels it. */
export function skillSource(s: Pick<SkillRecord, "scope" | "provider" | "pluginId">, names: Record<string, string>): string {
  const who = providerLabel(s.provider, names);
  switch (s.scope) {
    case "bb-builtin":
      return "bb built-in";
    case "bb-user":
      return "bb user";
    case "bb-project":
      return "bb project";
    case "plugin":
      return s.provider === null ? `bb plugin ${s.pluginId ?? "?"}` : `${who} plugin ${s.pluginId ?? "?"}`;
    case "provider-user":
      return `${who} user`;
    case "provider-project":
      return `${who} project`;
    case "shared-user":
      return "shared user";
    case "shared-project":
      return "shared project";
  }
}

/**
 * Precedence inside one tier, higher wins. bb's own order is documented (plugin < user < project, a project
 * skill overrides the rest); a provider's native order is assumed the same shape (user < project).
 */
const SCOPE_RANK: Record<SkillScope, number> = {
  plugin: 0,
  "bb-builtin": 0,
  "bb-user": 1,
  "provider-user": 1,
  "shared-user": 1,
  "bb-project": 2,
  "provider-project": 2,
  "shared-project": 2,
};

/** Who injects a skill into this thread. bb's tier is everything bb owns; a provider's is its native files. */
export function tierOf(s: Pick<SkillRecord, "provider">, threadProvider: string): Tier {
  if (s.provider === null) return "bb";
  return s.provider === threadProvider ? "provider" : "other-provider";
}

/** Which skills reach the thread, and which are shadowed, colliding, or another provider's. */
export function resolveSkills(records: readonly SkillRecord[], threadProvider: string, names: Record<string, string>): Skill[] {
  const skills: Skill[] = records.map(r => ({
    id: r.id,
    name: r.name,
    description: (r.description ?? "").trim(),
    source: skillSource(r, names),
    scope: r.scope,
    tier: tierOf(r, threadProvider),
    status: "active",
    filePath: r.filePath,
  }));
  const byTierName = new Map<string, Skill[]>();
  for (const s of skills) {
    if (s.tier === "other-provider") {
      s.status = "other-provider";
      continue;
    }
    const key = `${s.tier}\u0000${s.name}`;
    byTierName.set(key, [...(byTierName.get(key) ?? []), s]);
  }
  for (const same of byTierName.values()) {
    if (same.length < 2) continue;
    const top = Math.max(...same.map(s => SCOPE_RANK[s.scope]));
    const winners = same.filter(s => SCOPE_RANK[s.scope] === top);
    // bb drops both skills of one name within one of its sources; a provider's behavior there is unknown.
    const isCollision = winners.length > 1 && winners[0]!.tier === "bb" && new Set(winners.map(w => w.source)).size === 1;
    for (const s of same) {
      if (SCOPE_RANK[s.scope] < top) {
        s.status = "shadowed";
        s.shadowedBy = winners.map(w => w.source).join(", ");
      } else if (isCollision) {
        s.status = "collision";
      }
    }
  }
  // A name both bb and the provider define: both reach the agent; which it prefers is the provider's business.
  const live = skills.filter(s => s.status === "active");
  const sourcesByName = new Map<string, Skill[]>();
  for (const s of live) sourcesByName.set(s.name, [...(sourcesByName.get(s.name) ?? []), s]);
  for (const same of sourcesByName.values()) {
    if (new Set(same.map(s => s.tier)).size < 2) continue;
    for (const s of same) s.alsoIn = same.filter(o => o.tier !== s.tier).map(o => o.source);
  }
  return skills.sort(bySkillOrder);
}

/**
 * The heading a skill is listed under. bb's plugins mostly add one skill each, so they share one group (each row
 * names its plugin); every other source is its own group.
 */
export function skillGroup(s: Pick<Skill, "tier" | "scope" | "source">): string {
  return s.tier === "bb" && s.scope === "plugin" ? "bb plugins" : s.source;
}

const TIER_ORDER: Record<Tier, number> = { bb: 0, provider: 1, "other-provider": 2 };
const STATUS_ORDER: Record<SkillStatus, number> = { active: 0, collision: 1, shadowed: 2, "other-provider": 3 };

function bySkillOrder(a: Skill, b: Skill): number {
  return (
    TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    a.source.localeCompare(b.source) ||
    a.name.localeCompare(b.name)
  );
}

// ------------------------------------------------------------------ plugins

export function healthOf(p: Pick<PluginRecord, "enabled" | "status" | "services">): Health {
  if (!p.enabled || p.status === "disabled" || p.status === "stopped") return "off";
  if (p.status === "failed" || p.status === "incompatible" || p.status === "missing") return "error";
  if (p.status !== "running") return "warning";
  if (p.services.some(s => s.state !== "running")) return "warning";
  return "ok";
}

function plugin(p: PluginRecord, threadProvider: string): Plugin {
  const of = (kind: string) => p.capabilities.filter(c => c.kind === kind).map(c => c.label);
  const tools = of("agent-tool");
  const skills = of("skill");
  const integrations = of("thread-integration");
  const cli = p.cliCommand === null ? null : `bb ${p.cliCommand.name}`;
  const isThreadProvider = p.providerIds.includes(threadProvider);
  return {
    id: p.id,
    name: p.name,
    description: firstLine(p.description),
    icon: p.icon,
    version: p.version,
    provenance: p.provenance,
    status: p.status,
    statusDetail: p.statusDetail,
    health: healthOf(p),
    isThreadProvider,
    reachesAgent: p.enabled && (tools.length > 0 || skills.length > 0 || integrations.length > 0 || cli !== null || isThreadProvider),
    tools,
    skills,
    integrations,
    cli,
    services: p.services,
    scheduleCount: p.schedules.length,
    hasApp: p.hasApp,
  };
}

const HEALTH_ORDER: Record<Health, number> = { error: 0, warning: 1, ok: 2, off: 3 };

function byPluginOrder(a: Plugin, b: Plugin): number {
  return (
    Number(b.isThreadProvider) - Number(a.isThreadProvider) ||
    Number(b.reachesAgent) - Number(a.reachesAgent) ||
    HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] ||
    a.name.localeCompare(b.name)
  );
}

// ------------------------------------------------------------------ the whole inventory

export function buildInventory(s: Snapshot, builtAt: number): Inventory {
  const skills = resolveSkills(s.skills, s.thread.providerId, s.providerNames);
  const plugins = s.plugins.map(p => plugin(p, s.thread.providerId)).sort(byPluginOrder);
  const running = s.plugins.filter(p => p.enabled && healthOf(p) !== "error");
  const tools: Tool[] = running.flatMap(p =>
    p.capabilities.filter(c => c.kind === "agent-tool").map(c => ({ name: c.label, detail: (c.detail ?? "").trim(), pluginId: p.id, pluginName: p.name })),
  );
  const cliCommands: CliCommand[] = running
    .filter(p => p.cliCommand !== null)
    .map(p => ({ command: `bb ${p.cliCommand!.name}`, summary: p.cliCommand!.summary, pluginId: p.id, pluginName: p.name }))
    .sort((a, b) => a.command.localeCompare(b.command));
  const instructions: Instruction[] = s.files
    .filter(f => f.exists)
    .map(f => ({
      label: f.label,
      kind: f.kind,
      path: f.path,
      hostId: f.hostId,
      sizeBytes: f.sizeBytes,
      approxTokens: f.sizeBytes === null ? null : Math.ceil(f.sizeBytes / 4),
      ...(f.note === undefined ? {} : { note: f.note }),
    }));
  const missing = s.files.filter(f => !f.exists).map(f => f.path);
  const ctx = s.context;
  const context = ctx === null || ctx.window <= 0 ? null : { ...ctx, ratio: Math.min(1, ctx.usedTokens / ctx.window) };
  return {
    builtAt,
    thread: {
      id: s.thread.id,
      title: s.thread.title,
      providerId: s.thread.providerId,
      providerName: s.provider?.displayName ?? s.providerNames[s.thread.providerId] ?? s.thread.providerId,
      providerAvailable: s.provider?.available ?? false,
      options: s.options,
      model: s.options?.model ?? ctx?.model ?? null,
    },
    environment: s.environment,
    context,
    instructions,
    missingInstructions: missing,
    skills,
    tools,
    cliCommands,
    plugins,
    counts: {
      activeSkills: skills.filter(k => k.status === "active").length,
      tools: tools.length,
      cliCommands: cliCommands.length,
      instructions: instructions.filter(i => i.kind !== "env-hook").length,
      pluginProblems: plugins.filter(p => p.health === "error" || p.health === "warning").length,
    },
    problems: s.problems,
  };
}

// ------------------------------------------------------------------ text

export type TextOptions = {
  /** List every skill and tool by name, not only the counts per source. */
  full?: boolean;
  /** Also list other providers' skills. */
  otherProviders?: boolean;
};

const n = (x: number) => x.toLocaleString("en-US");

/** Markdown for the CLI, for agents, and for the panel's Copy button. */
export function inventoryMarkdown(inv: Inventory, opts: TextOptions = {}): string {
  const t = inv.thread;
  const lines: string[] = [`# Agent artifacts: ${t.title ?? t.id}`, ""];
  const opt = t.options;
  const model = t.model === null ? "model unknown" : `model ${t.model}`;
  const extra = opt === null ? "" : `, reasoning ${opt.reasoningLevel}, permissions ${opt.permissionMode} (${opt.from})`;
  lines.push(`- Provider: ${t.providerName}${t.providerAvailable ? "" : " (unavailable)"}, ${model}${extra}`);
  const env = inv.environment;
  if (env !== null) {
    const where = [env.branchName === null ? null : `branch ${env.branchName}`, env.isWorktree ? "worktree" : null].filter(x => x !== null).join(", ");
    lines.push(`- Workspace: ${env.path ?? "(not on disk yet)"}${where === "" ? "" : ` (${where})`}`);
  }
  if (inv.context !== null) {
    const c = inv.context;
    lines.push(`- Context: ${n(c.usedTokens)} / ${n(c.window)} tokens (${Math.round(c.ratio * 100)}%${c.estimated ? ", estimated" : ""})`);
  }
  const k = inv.counts;
  lines.push(`- Totals: ${k.instructions} instruction files, ${k.activeSkills} skills, ${k.tools} plugin tools, ${k.cliCommands} plugin CLI commands`);

  lines.push("", "## Instructions and hooks");
  if (inv.instructions.length === 0) lines.push("None found.");
  for (const i of inv.instructions) {
    const size = i.approxTokens === null ? "" : ` (~${n(i.approxTokens)} tok)`;
    lines.push(`- ${i.label}: ${i.path}${size}${i.note === undefined ? "" : ` — ${i.note}`}`);
  }

  lines.push("", "## Skills");
  const shown = inv.skills.filter(s => opts.otherProviders === true || s.tier !== "other-provider");
  const byGroup = new Map<string, Skill[]>();
  for (const s of shown) byGroup.set(skillGroup(s), [...(byGroup.get(skillGroup(s)) ?? []), s]);
  if (shown.length === 0) lines.push("None.");
  for (const [group, skills] of byGroup) {
    const active = skills.filter(s => s.status === "active").length;
    const off = skills.length - active;
    lines.push(`- ${group}: ${active}${off > 0 ? ` (+${off} not reaching the agent)` : ""}`);
    if (opts.full !== true) continue;
    for (const s of skills) {
      const from = s.source === group ? "" : ` (${s.source})`;
      const flag = s.status === "active" ? "" : s.status === "shadowed" ? ` [shadowed by ${s.shadowedBy}]` : ` [${s.status}]`;
      const also = s.alsoIn === undefined ? "" : ` [also in ${s.alsoIn.join(", ")}]`;
      lines.push(`  - ${s.name}${from}${flag}${also}: ${firstLine(s.description)}`);
    }
  }

  lines.push("", "## Plugin tools");
  if (inv.tools.length === 0) lines.push("None.");
  for (const tool of inv.tools) lines.push(`- ${tool.name} (${tool.pluginName})${opts.full === true ? `: ${firstLine(tool.detail, 240)}` : ""}`);

  lines.push("", "## Plugin CLI commands");
  if (inv.cliCommands.length === 0) lines.push("None.");
  for (const c of inv.cliCommands) lines.push(`- \`${c.command}\`: ${c.summary}`);

  const troubled = inv.plugins.filter(p => p.health === "error" || p.health === "warning");
  if (troubled.length > 0 || inv.problems.length > 0) {
    lines.push("", "## Problems");
    for (const p of troubled) lines.push(`- plugin ${p.name}: ${p.status}${p.statusDetail === null ? "" : ` — ${p.statusDetail}`}`);
    for (const p of inv.problems) lines.push(`- ${p}`);
  }
  return lines.join("\n");
}
