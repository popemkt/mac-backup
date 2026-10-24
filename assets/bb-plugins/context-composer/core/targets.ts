// Compile targets: how a manifest's decisions reach a real agent on one host, and how far each one is honoured.
// A target knows its levers; compile() turns a manifest into the env, arguments and instruction text a launch on that
// host takes, and labels every change `enforced` (the host removes or adds it), `advisory` (the agent is only told)
// or `none` (nothing can change it). The facts behind each lever are cited in
// docs/research/2026-10-25-context-composer-v1.md ("Levers per provider"); the tests pin the rules.
import { diff, isRemovable, KIND_LABELS, type Artifact, type ArtifactKind, type Composition, type Manifest, type Source } from "./model.ts";

export type Enforcement = "enforced" | "advisory" | "none";

export type Lever = {
  enforcement: Enforcement;
  /** How, in a line: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 (plugin-contributed env)`. */
  via: string;
  /** Measured outside the host only, or read in source but never run end to end. */
  experimental?: boolean;
};

/** A lever that removes a whole group at once, so it applies only when every member of the group is excluded. */
type GroupLever = {
  id: string;
  covers: (a: Artifact, s: Source) => boolean;
  env?: Record<string, string>;
  args?: string[];
  lever: Lever;
};

/** An item lever may carry the env and arguments it needs. */
type ItemLever = Lever & { env?: Record<string, string>; args?: string[]; tag?: string };

export type TargetId = "bb:claude-code" | "bb:codex" | "bb:pi" | "bb:other" | "cli:claude-code" | "cli:codex";

export type Target = {
  id: TargetId;
  label: string;
  /** The provider id it compiles for; null for the fallback that takes any other bb provider. */
  providerId: string | null;
  surface: "bb" | "cli";
  /** The most instruction text the target carries; bb truncates `agents.configure` instructions at 4096. */
  instructionLimit: number | null;
  groups: GroupLever[];
  item: (a: Artifact, s: Source) => ItemLever;
  /** How added instruction text reaches the agent. */
  additions: Lever;
  /** Standing caveats shown with every plan. */
  notes: string[];
};

// ------------------------------------------------------------------ the levers

const ADVISORY_TEXT: Lever = { enforcement: "advisory", via: "named in the composer's instructions as not to be used" };

const providerSide = (s: Source) => s.injector === "provider";
const isContext = (k: ArtifactKind) => k === "instruction" || k === "memory";

/** Claude Code's env switches. Measured on Claude Code 2.1.310 with a session that never got a prompt. */
const CLAUDE_ENV_GROUPS = (via: string): GroupLever[] => [
  {
    id: "claude-safe-mode",
    covers: (a, s) => providerSide(s) && isRemovable(a),
    env: { CLAUDE_CODE_SAFE_MODE: "1" },
    lever: { enforcement: "enforced", via: `CLAUDE_CODE_SAFE_MODE=1 (${via}): no CLAUDE.md, skills beyond built-ins, plugins, hooks, MCP or subagents`, experimental: true },
  },
  {
    id: "claude-no-claude-mds",
    covers: (a, s) => providerSide(s) && isContext(a.kind),
    env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" },
    lever: { enforcement: "enforced", via: `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 (${via}): every CLAUDE.md and MEMORY.md` },
  },
  {
    id: "claude-no-auto-memory",
    covers: (a, s) => providerSide(s) && a.kind === "memory",
    env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
    lever: { enforcement: "enforced", via: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 (${via})` },
  },
  {
    id: "claude-no-bundled-skills",
    covers: (a, s) => providerSide(s) && a.kind === "skill" && s.scope === "builtin",
    env: { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" },
    lever: { enforcement: "enforced", via: `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 (${via})` },
  },
];

const BB_HOST_ITEM: ItemLever = {
  ...ADVISORY_TEXT,
  via: "advisory: bb adds it for every provider, and a plugin can only add its own tools and skills, never remove another's",
};

const bbClaude: Target = {
  id: "bb:claude-code",
  label: "bb thread, Claude Code",
  providerId: "claude-code",
  surface: "bb",
  instructionLimit: 4096,
  groups: CLAUDE_ENV_GROUPS("plugin-contributed env"),
  item: (_a, s) =>
    s.injector === "host"
      ? BB_HOST_ITEM
      : { ...ADVISORY_TEXT, via: "advisory: bb's bridge loads the user, project and local settings as they are; per-item removal needs a forked provider" },
  additions: { enforcement: "enforced", via: "agents.configure instructions, appended to the system prompt at session start" },
  notes: ["A fresh spawn starts without the conversation; only a fork carries it.", "Env switches apply from the session's next start, so they shape new threads, not running ones."],
};

// GAP [[01M5QKD7E3SR1DT4Z39TY3ZTGF]] per-item drops on bb Claude Code and Codex stay advisory until a forked provider.
const bbCodex: Target = {
  id: "bb:codex",
  label: "bb thread, Codex",
  providerId: "codex",
  surface: "bb",
  instructionLimit: 4096,
  groups: [],
  item: (_a, s) =>
    s.injector === "host"
      ? BB_HOST_ITEM
      : { ...ADVISORY_TEXT, via: "advisory: contributed env does not reach Codex's app server, and bb passes -c only for its own keys" },
  additions: { enforcement: "enforced", via: "agents.configure instructions, sent as developer instructions" },
  notes: ["A fresh spawn starts without the conversation; only a fork carries it."],
};

/** The names the composer's pi extension filters, by kind. See pi/extension.ts. */
const PI_FILTERS: Partial<Record<ArtifactKind, string>> = {
  skill: "skills",
  tool: "tools",
  "mcp-server": "mcpServers",
  instruction: "contextFiles",
};

const bbPi: Target = {
  id: "bb:pi",
  label: "bb thread, pi",
  providerId: "pi",
  surface: "bb",
  instructionLimit: 4096,
  groups: [],
  item: (a, s) => {
    const filter = PI_FILTERS[a.kind];
    if (filter !== undefined && !(a.kind === "instruction" && s.injector === "host")) {
      return { enforcement: "enforced", via: `composer pi extension drops it before each request (${filter})`, experimental: true, tag: filter };
    }
    return s.injector === "host" ? BB_HOST_ITEM : ADVISORY_TEXT;
  },
  additions: { enforcement: "enforced", via: "agents.configure instructions, appended to pi's system prompt" },
  notes: [
    "Enforcement needs the composer pi extension in ~/.pi/agent/extensions on the machine that runs pi; it reads PI_COMPOSER_MANIFEST.",
    "A fresh spawn starts without the conversation; only a fork carries it.",
  ],
};

const bbOther: Target = {
  id: "bb:other",
  label: "bb thread, other provider",
  providerId: null,
  surface: "bb",
  instructionLimit: 4096,
  groups: [],
  item: (_a, s) => (s.injector === "host" ? BB_HOST_ITEM : ADVISORY_TEXT),
  additions: { enforcement: "enforced", via: "agents.configure instructions" },
  notes: ["A fresh spawn starts without the conversation; only a fork carries it."],
};

const cliClaude: Target = {
  id: "cli:claude-code",
  label: "claude CLI (outside bb)",
  providerId: "claude-code",
  surface: "cli",
  instructionLimit: null,
  groups: CLAUDE_ENV_GROUPS("env"),
  item: (a, s) => {
    if (a.kind === "mcp-server" && s.injector === "provider") {
      return { enforcement: "enforced", via: `--disallowedTools mcp__${mcpRuleName(a.name)}`, args: ["--disallowedTools", `mcp__${mcpRuleName(a.name)}`] };
    }
    if (a.kind === "subagent" && s.injector === "provider") {
      return { enforcement: "enforced", via: `--disallowedTools Agent(${a.name})`, args: ["--disallowedTools", `Agent(${a.name})`], experimental: true };
    }
    return ADVISORY_TEXT;
  },
  additions: { enforcement: "enforced", via: "--append-system-prompt" },
  notes: ["`--setting-sources` and `--strict-mcp-config --mcp-config` give a blank slate a bb thread cannot have; see the research doc."],
};

const cliCodex: Target = {
  id: "cli:codex",
  label: "codex CLI (outside bb)",
  providerId: "codex",
  surface: "cli",
  instructionLimit: null,
  groups: [
    {
      id: "codex-no-project-docs",
      covers: (a, s) => providerSide(s) && a.kind === "instruction",
      args: ["-c", "project_doc_max_bytes=0"],
      lever: { enforcement: "enforced", via: "-c project_doc_max_bytes=0 (every AGENTS.md)", experimental: true },
    },
  ],
  item: (a, s) => {
    if (a.kind === "mcp-server" && s.injector === "provider") {
      return { enforcement: "enforced", via: `-c mcp_servers.${a.name}.enabled=false`, args: ["-c", `mcp_servers.${a.name}.enabled=false`], experimental: true };
    }
    return ADVISORY_TEXT;
  },
  additions: { enforcement: "enforced", via: "prepended to the first prompt" },
  notes: ["A clean CODEX_HOME drops ~/.codex/AGENTS.md, skills and MCP config, but has no login until auth.json is copied in."],
};

export const TARGETS: readonly Target[] = [bbClaude, bbCodex, bbPi, bbOther, cliClaude, cliCodex];

/** Claude Code names MCP tools `mcp__<server>__<tool>`, with the server name's other characters as `_`. */
export const mcpRuleName = (server: string): string => server.replace(/[^A-Za-z0-9_-]/g, "_");

/** The target a bb thread of this provider compiles to. */
export function bbTargetFor(providerId: string): Target {
  return TARGETS.find(t => t.surface === "bb" && t.providerId === providerId) ?? bbOther;
}

export const targetById = (id: string): Target | undefined => TARGETS.find(t => t.id === id);

/** The env var the composer's pi extension reads its filters from. */
export const PI_MANIFEST_ENV = "PI_COMPOSER_MANIFEST";

/** Every env name a target's plan can carry: what a host adapter may pass on for it, and nothing else. */
export function envNames(t: Target): string[] {
  const names = new Set(t.groups.flatMap(g => Object.keys(g.env ?? {})));
  if (t.id === "bb:pi") names.add(PI_MANIFEST_ENV);
  return [...names];
}

// ------------------------------------------------------------------ compile

export type Step = { artifact: Artifact; change: "remove" | "add"; lever: Lever; group?: string };

export type Plan = {
  targetId: TargetId;
  steps: Step[];
  /** Env for the agent's process: plugin-contributed in bb, a prefix on the command line outside it. */
  env: Record<string, string>;
  args: string[];
  /** Filters for the composer pi extension, by kind; empty unless the target is pi. */
  piFilters: Record<string, string[]>;
  /** The text the agent receives: the person's additions, then what it is asked to leave alone. */
  instructions: string;
  instructionsTruncated: boolean;
  counts: Record<Enforcement, number>;
  warnings: string[];
};

/** The lever that takes one artifact out, ignoring groups: what the UI shows before a decision is made. */
export function itemLever(t: Target, a: Artifact, s: Source): Lever {
  if (!isRemovable(a)) return { enforcement: "none", via: a.kind === "conversation" ? "a fresh spawn drops it; a fork keeps it" : "the provider's own prompt and tools" };
  const { enforcement, via, experimental } = t.item(a, s);
  return { enforcement, via, ...(experimental === true ? { experimental } : {}) };
}

export function compile(t: Target, c: Composition, m: Manifest): Plan {
  const sources = new Map(c.sources.map(s => [s.id, s]));
  const sourceOf = (a: Artifact): Source => sources.get(a.sourceId) ?? { id: a.sourceId, label: a.sourceId, injector: "provider", scope: "user" };
  const d = diff(c, m);
  const removed = new Set(d.removed.map(a => a.id));
  const env: Record<string, string> = {};
  const args: string[] = [];
  const piFilters: Record<string, string[]> = {};
  const steps: Step[] = [];
  const covered = new Set<string>();
  const warnings: string[] = [];

  // Group levers first, widest first: each applies only when it would remove nothing the manifest keeps.
  for (const g of t.groups) {
    const members = c.artifacts.filter(a => a.active && isRemovable(a) && !covered.has(a.id) && g.covers(a, sourceOf(a)));
    if (members.length === 0 || !members.every(a => removed.has(a.id))) continue;
    Object.assign(env, g.env ?? {});
    args.push(...(g.args ?? []));
    for (const a of members) {
      covered.add(a.id);
      steps.push({ artifact: a, change: "remove", lever: g.lever, group: g.id });
    }
  }

  const advisory: Artifact[] = [];
  for (const a of d.removed) {
    if (covered.has(a.id)) continue;
    const lever = t.item(a, sourceOf(a));
    if (!isRemovable(a)) {
      steps.push({ artifact: a, change: "remove", lever: itemLever(t, a, sourceOf(a)) });
      continue;
    }
    Object.assign(env, lever.env ?? {});
    args.push(...(lever.args ?? []));
    if (lever.tag !== undefined) (piFilters[lever.tag] ??= []).push(a.kind === "instruction" ? (a.path ?? a.name) : a.name);
    if (lever.enforcement === "advisory") advisory.push(a);
    const { enforcement, via, experimental } = lever;
    steps.push({ artifact: a, change: "remove", lever: { enforcement, via, ...(experimental === true ? { experimental } : {}) } });
  }

  const toRead: Artifact[] = [];
  for (const a of d.added) {
    const lever: Lever =
      a.path === undefined
        ? { enforcement: "none", via: "inactive here and no file to point the agent at" }
        : { enforcement: "advisory", via: `the agent is pointed at ${a.path}` };
    if (a.path !== undefined) toRead.push(a);
    steps.push({ artifact: a, change: "add", lever });
  }

  if (Object.keys(piFilters).length > 0) env[PI_MANIFEST_ENV] = JSON.stringify(piFilters);
  if (d.unknown.length > 0) warnings.push(`${d.unknown.length} decision(s) name artifacts this workspace no longer has; they are ignored.`);
  if (steps.some(s => s.lever.experimental === true)) warnings.push("Some levers are experimental: measured outside bb or read in source only.");

  const text = instructionText(m.additions.instructions, advisory, toRead, t.instructionLimit);
  if (text.truncated) warnings.push(`The instruction text was cut to ${t.instructionLimit} characters; some names are summarised.`);
  if (t.instructionLimit === null && text.text !== "" && t.id === "cli:claude-code") args.push("--append-system-prompt", text.text);

  const counts: Record<Enforcement, number> = { enforced: 0, advisory: 0, none: 0 };
  for (const s of steps) counts[s.lever.enforcement] += 1;
  return { targetId: t.id, steps, env, args, piFilters, instructions: text.text, instructionsTruncated: text.truncated, counts, warnings };
}

/** The instruction text: additions, then the advisory exclusions by kind, then files to read; cut to the limit. */
export function instructionText(additions: string, avoid: Artifact[], read: Artifact[], limit: number | null): { text: string; truncated: boolean } {
  const head = additions.trim();
  const byKind = new Map<ArtifactKind, string[]>();
  for (const a of avoid) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a.name]);
  const build = (cap: number): string => {
    const parts: string[] = [];
    if (head !== "") parts.push(head);
    if (byKind.size > 0) {
      const lines = [...byKind].map(([k, names]) => {
        const shown = names.slice(0, cap);
        const more = names.length - shown.length;
        return `- ${KIND_LABELS[k]}: ${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""}`;
      });
      parts.push(
        ["Context composition: the person composing this session asked that you do not use the following, although they are still loaded. Treat them as unavailable unless the person asks for one by name.", ...lines].join("\n"),
      );
    }
    if (read.length > 0) {
      parts.push(["Also part of this session's context; read each when its subject comes up:", ...read.slice(0, cap).map(a => `- ${a.name}: ${a.path}`)].join("\n"));
    }
    return parts.join("\n\n");
  };
  const full = build(Number.MAX_SAFE_INTEGER);
  if (limit === null || full.length <= limit) return { text: full, truncated: false };
  for (let cap = 40; cap >= 0; cap = cap > 10 ? cap - 10 : cap - 1) {
    const t = build(cap);
    if (t.length <= limit) return { text: t, truncated: true };
  }
  return { text: full.slice(0, limit), truncated: true };
}

/** A shell line for a CLI target: env prefix, the program, its arguments. */
export function commandLine(t: Target, p: Plan, prompt: string): string | null {
  if (t.surface !== "cli") return null;
  const q = (s: string) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  const env = Object.entries(p.env).map(([k, v]) => `${k}=${q(v)}`);
  const program = t.id === "cli:claude-code" ? "claude" : "codex";
  const first = t.id === "cli:codex" && p.instructions !== "" ? `${p.instructions}\n\n${prompt}` : prompt;
  return [...env, program, ...p.args.map(q), q(first)].join(" ");
}
