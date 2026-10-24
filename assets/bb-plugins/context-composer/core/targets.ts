// Compile targets: how a manifest's decisions reach a real agent on one host, and how far each one is honoured.
// A target knows its levers; compile() turns a manifest into the env, arguments and instruction text a launch on that
// host takes, and labels every change `enforced` (the host removes or adds it), `advisory` (the agent is only told)
// or `none` (nothing can change it); ENFORCEMENT below is the one statement of what those mean. The facts behind
// each lever are cited in docs/research/2026-10-25-context-composer-v1.md ("Levers per provider"); the tests pin them.
import { diff, isIncluded, isRemovable, KIND_LABELS, type Artifact, type ArtifactKind, type Composition, type Manifest, type Source } from "./model.ts";
import { clip, inline } from "./strings.ts";

export type Enforcement = "enforced" | "advisory" | "none";

/** What each enforcement level means: the canonical statement. The CLI help, the app and the brief all quote it. */
export const ENFORCEMENT: Record<Enforcement, string> = {
  enforced: "the host removes (or adds) it",
  advisory: "it stays loaded; the agent is only told not to use it",
  none: "nothing changes it here",
};

/** Marked `*`: measured outside the host, or read in source, but not seen working in a live bb thread. */
export const EXPERIMENTAL = "measured outside bb or read in source only, not yet seen in a live bb thread";

/** ENFORCEMENT as one line, for text surfaces. */
export const enforcementLegend = (): string =>
  `${(Object.keys(ENFORCEMENT) as Enforcement[]).map(e => `${e} = ${ENFORCEMENT[e]}`).join("; ")}; * = ${EXPERIMENTAL}`;

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
  /** Shown with the plan whenever the group applies. */
  warning?: string;
};

/**
 * An item lever may carry the env and arguments it needs, or a filter entry: `key` goes into the target's
 * `filterEnv` JSON under `list`. A filter matches by key alone, so compile() only uses it when no kept artifact
 * shares the key.
 */
type ItemLever = Lever & { env?: Record<string, string>; args?: string[]; filter?: { list: string; key: string } };

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
  /** The env var an adapter that filters by key (the composer's pi extension) reads its filters from, as JSON. */
  filterEnv?: string;
  /** Outside bb: the program, and the arguments that carry the instruction text; without them the text leads the prompt. */
  cli?: { program: string; instructionArgs?: (text: string) => string[] };
};

// ------------------------------------------------------------------ the levers

const ADVISORY_TEXT: Lever = { enforcement: "advisory", via: "named in the composer's instructions as not to be used" };

const providerSide = (s: Source) => s.injector === "provider";
const isContext = (k: ArtifactKind) => k === "instruction" || k === "memory";

/**
 * Claude Code's env switches. Measured on Claude Code 2.1.310 with a session that never got a prompt. Safe mode keeps
 * the built-in skills, so it never covers them; the bundled-skills switch owns those. In bb the switches travel as
 * plugin-contributed env, which has not been seen reaching a live thread, so there every one is experimental.
 */
// GAP [[01M5QKD89DMW3BR5RS6SYZD3RJ]] contributed env has not been seen reaching a live bb Claude Code thread.
const CLAUDE_ENV_GROUPS = (via: string, inBb: boolean): GroupLever[] => {
  const lever = (how: string, measuredDirectly: boolean): Lever => ({ enforcement: "enforced", via: `${how} (${via})`, ...(inBb || !measuredDirectly ? { experimental: true } : {}) });
  return [
    {
      id: "claude-safe-mode",
      covers: (a, s) => providerSide(s) && isRemovable(a) && s.scope !== "builtin",
      env: { CLAUDE_CODE_SAFE_MODE: "1" },
      lever: lever("CLAUDE_CODE_SAFE_MODE=1: no CLAUDE.md, user or project skills, plugins, hooks, MCP or subagents; built-in skills stay", false),
      ...(inBb ? { warning: "CLAUDE_CODE_SAFE_MODE may also drop what bb injects into Claude Code (its bb-bridge MCP server and skill plugin), which would leave the thread without bb's tools. Unverified." } : {}),
    },
    {
      id: "claude-no-claude-mds",
      covers: (a, s) => providerSide(s) && isContext(a.kind),
      env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" },
      lever: lever("CLAUDE_CODE_DISABLE_CLAUDE_MDS=1: every CLAUDE.md and MEMORY.md", true),
    },
    {
      id: "claude-no-auto-memory",
      covers: (a, s) => providerSide(s) && a.kind === "memory",
      env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
      lever: lever("CLAUDE_CODE_DISABLE_AUTO_MEMORY=1", true),
    },
    {
      id: "claude-no-bundled-skills",
      covers: (a, s) => providerSide(s) && a.kind === "skill" && s.scope === "builtin",
      env: { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" },
      lever: lever("CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1", true),
    },
  ];
};

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
  groups: CLAUDE_ENV_GROUPS("plugin-contributed env", true),
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

/** The env var the composer's pi extension reads its filters from. */
export const PI_MANIFEST_ENV = "PI_COMPOSER_MANIFEST";

/** The lists the composer's pi extension filters, by kind, and the key each matches on. See pi/extension.ts. */
const PI_FILTERS: Partial<Record<ArtifactKind, { list: string; key: (a: Artifact) => string | undefined }>> = {
  skill: { list: "skills", key: a => a.name },
  tool: { list: "tools", key: a => a.name },
  "mcp-server": { list: "mcpServers", key: a => a.name },
  // Context files match by path only: a bare `AGENTS.md` would match every directory's.
  instruction: { list: "contextFiles", key: a => a.path },
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
    const key = filter?.key(a);
    if (filter !== undefined && key !== undefined && !(a.kind === "instruction" && s.injector === "host")) {
      return { enforcement: "enforced", via: `composer pi extension drops it before each request (${filter.list})`, experimental: true, filter: { list: filter.list, key } };
    }
    return s.injector === "host" ? BB_HOST_ITEM : ADVISORY_TEXT;
  },
  filterEnv: PI_MANIFEST_ENV,
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
  groups: CLAUDE_ENV_GROUPS("env", false),
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
  cli: { program: "claude", instructionArgs: text => ["--append-system-prompt", text] },
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
  cli: { program: "codex" },
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

/** Every env name a target's plan can carry: what a host adapter may pass on for it, and nothing else. */
export function envNames(t: Target): string[] {
  const names = new Set(t.groups.flatMap(g => Object.keys(g.env ?? {})));
  if (t.filterEnv !== undefined) names.add(t.filterEnv);
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

const FALLBACK_SOURCE = (id: string): Source => ({ id, label: id, injector: "provider", scope: "user" });

/** What decides whether a filter lever is safe: the composition's artifacts and which of them are kept. */
type Peers = { artifacts: readonly Artifact[]; sourceOf: (a: Artifact) => Source; kept: (a: Artifact) => boolean };

/** The target's item lever, downgraded to advisory when its filter key would also catch a kept artifact. */
function resolveItem(t: Target, a: Artifact, s: Source, peers: Peers | null): ItemLever {
  const lever = t.item(a, s);
  const f = lever.filter;
  if (f === undefined || peers === null) return lever;
  const clash = peers.artifacts.some(b => {
    if (b.id === a.id || b.kind !== a.kind || !peers.kept(b)) return false;
    const g = t.item(b, peers.sourceOf(b)).filter;
    return g !== undefined && g.list === f.list && g.key === f.key;
  });
  return clash ? { ...ADVISORY_TEXT, via: `advisory: a kept ${KIND_LABELS[a.kind].toLowerCase()} entry is also called "${inline(f.key, 60)}", and the filter matches by name` } : lever;
}

const asLever = ({ enforcement, via, experimental }: Lever): Lever => ({ enforcement, via, ...(experimental === true ? { experimental } : {}) });

/**
 * The lever that takes one artifact out, ignoring groups: what the UI shows before a decision is made. Pass the
 * composition (and the manifest) so a filter lever whose key a kept artifact shares is shown as the advisory it is.
 */
export function itemLever(t: Target, a: Artifact, s: Source, scope?: { composition: Composition; manifest?: Manifest }): Lever {
  if (!isRemovable(a)) return { enforcement: "none", via: a.kind === "conversation" ? "a fresh spawn drops it; a fork keeps it" : "the provider's own prompt and tools" };
  const peers = scope === undefined ? null : peersOf(scope.composition, scope.manifest);
  return asLever(resolveItem(t, a, s, peers));
}

function peersOf(c: Composition, m: Manifest | undefined): Peers {
  const sources = new Map(c.sources.map(s => [s.id, s]));
  return { artifacts: c.artifacts, sourceOf: a => sources.get(a.sourceId) ?? FALLBACK_SOURCE(a.sourceId), kept: b => (m === undefined ? b.active : isIncluded(b, m)) };
}

export function compile(t: Target, c: Composition, m: Manifest): Plan {
  const peers = peersOf(c, m);
  const { sourceOf } = peers;
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
    if (g.warning !== undefined) warnings.push(g.warning);
    for (const a of members) {
      covered.add(a.id);
      steps.push({ artifact: a, change: "remove", lever: g.lever, group: g.id });
    }
  }

  const advisory: Artifact[] = [];
  for (const a of d.removed) {
    if (covered.has(a.id)) continue;
    const lever = resolveItem(t, a, sourceOf(a), peers);
    Object.assign(env, lever.env ?? {});
    args.push(...(lever.args ?? []));
    if (lever.filter !== undefined) (piFilters[lever.filter.list] ??= []).push(lever.filter.key);
    if (lever.enforcement === "advisory") advisory.push(a);
    steps.push({ artifact: a, change: "remove", lever: asLever(lever) });
  }

  const toRead: Artifact[] = [];
  for (const a of d.added) {
    const lever: Lever =
      a.path === undefined
        ? { enforcement: "none", via: "inactive here and no file to point the agent at" }
        : { enforcement: "advisory", via: `the agent is pointed at ${inline(a.path, 300)}` };
    if (a.path !== undefined) toRead.push(a);
    steps.push({ artifact: a, change: "add", lever });
  }

  if (t.filterEnv !== undefined && Object.keys(piFilters).length > 0) env[t.filterEnv] = JSON.stringify(piFilters);
  if (d.unknown.length > 0) warnings.push(`${d.unknown.length} decision(s) name artifacts this workspace no longer has; they are ignored.`);

  const text = instructionText(m.additions.instructions, advisory, toRead, t.instructionLimit);
  // An advisory step whose name did not fit is not told to the agent at all: say so instead of claiming advice.
  if (text.omitted.length > 0) {
    const omitted = new Set(text.omitted.map(a => a.id));
    for (const st of steps) {
      if (omitted.has(st.artifact.id)) st.lever = { enforcement: "none", via: `not named to the agent: no room in the ${t.instructionLimit}-character instruction text` };
    }
    warnings.push(`${text.omitted.length} change(s) did not fit in the ${t.instructionLimit}-character instruction text, so the agent is not told about them; they show as none.`);
  }
  if (text.additionsCut) warnings.push(`The added instructions were cut to fit ${t.instructionLimit} characters after the exclusions; shorten them.`);
  if (steps.some(st => st.lever.experimental === true)) warnings.push(`Some levers are experimental (*): ${EXPERIMENTAL}.`);
  if (t.cli?.instructionArgs !== undefined && text.text !== "") args.push(...t.cli.instructionArgs(text.text));

  const counts: Record<Enforcement, number> = { enforced: 0, advisory: 0, none: 0 };
  for (const st of steps) counts[st.lever.enforcement] += 1;
  return { targetId: t.id, steps, env, args, piFilters, instructions: text.text, instructionsTruncated: text.omitted.length > 0 || text.additionsCut, counts, warnings };
}

export type InstructionText = {
  text: string;
  /** Artifacts the text has no room to name: a summary line counts them, but the agent is not told which. */
  omitted: Artifact[];
  /** Whether the person's additions were cut to leave room for the exclusions. */
  additionsCut: boolean;
};

/**
 * The instruction text: the person's additions, then what the agent is asked to leave alone, then files to read.
 * Within a limit, the exclusions get their room first (names summarised per kind if they must be), and the additions
 * take what is left. Names are inventory text, so each is flattened to one line and capped.
 */
export function instructionText(additions: string, avoid: Artifact[], read: Artifact[], limit: number | null): InstructionText {
  const head = additions.trim();
  const byKind = new Map<ArtifactKind, Artifact[]>();
  for (const a of avoid) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a]);
  const blocks = (cap: number): { text: string; omitted: Artifact[] } => {
    const parts: string[] = [];
    const omitted: Artifact[] = [];
    if (byKind.size > 0) {
      const lines = [...byKind].map(([k, items]) => {
        const shown = items.slice(0, cap);
        omitted.push(...items.slice(shown.length));
        const more = items.length - shown.length;
        const names = shown.map(a => inline(a.name, 80)).join(", ");
        return `- ${KIND_LABELS[k]}: ${names}${more > 0 ? `${names === "" ? "" : ","} and ${more} more not named here` : ""}`;
      });
      parts.push(
        ["Context composition: the person composing this session asked that you do not use the following, although they are still loaded. Treat them as unavailable unless the person asks for one by name.", ...lines].join("\n"),
      );
    }
    if (read.length > 0) {
      const shown = read.slice(0, cap);
      omitted.push(...read.slice(shown.length));
      parts.push(["Also part of this session's context; read each when its subject comes up:", ...shown.map(a => `- ${inline(a.name, 80)}: ${inline(a.path ?? "", 300)}`)].join("\n"));
    }
    return { text: parts.join("\n\n"), omitted };
  };
  const join = (h: string, b: string) => [h, b].filter(x => x !== "").join("\n\n");
  let b = blocks(Number.MAX_SAFE_INTEGER);
  if (limit === null || join(head, b.text).length <= limit) return { text: join(head, b.text), omitted: [], additionsCut: false };
  // The exclusions first: the most names per kind whose blocks fit on their own.
  for (let cap = 40; b.text.length > limit && cap >= 0; cap = cap > 10 ? cap - 10 : cap - 1) b = blocks(cap);
  if (b.text.length > limit) b = { text: clip(b.text, limit), omitted: [...avoid, ...read] };
  const room = limit - b.text.length - (b.text === "" ? 0 : 2);
  if (head.length <= room) return { text: join(head, b.text), omitted: b.omitted, additionsCut: false };
  return { text: join(room > 1 ? clip(head, room) : "", b.text), omitted: b.omitted, additionsCut: head !== "" };
}

/** A shell line for a CLI target: env prefix, the program, its arguments. */
export function commandLine(t: Target, p: Plan, prompt: string): string | null {
  if (t.cli === undefined) return null;
  const q = (s: string) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  const env = Object.entries(p.env).map(([k, v]) => `${k}=${q(v)}`);
  const first = t.cli.instructionArgs === undefined && p.instructions !== "" ? `${p.instructions}\n\n${prompt}` : prompt;
  return [...env, t.cli.program, ...p.args.map(q), q(first)].join(" ");
}
