// The composition model: what feeds an agent (sources and the artifacts they define), and a manifest of decisions
// over it. Pure data and pure functions. No host imports: nothing here knows bb, pi, Claude Code or Codex; adapters
// map a host's inventory in (adapter/) and targets compile decisions out (targets.ts). tests/core.test.ts ("core imports
// no host") keeps it that way.

/** What an artifact is, by the role it plays in an agent's context. */
export type ArtifactKind =
  /** An instruction file the provider or bb loads at start (CLAUDE.md, AGENTS.md, bb's AGENTS.md). */
  | "instruction"
  /** Auto memory loaded at start (Claude Code's MEMORY.md). */
  | "memory"
  /** A skill: listed by name and description, loaded on demand. */
  | "skill"
  /** An MCP server and the tools it offers. */
  | "mcp-server"
  /** A tool a bb plugin registers for agents. */
  | "tool"
  /** A hook that runs on agent events and may inject text. */
  | "hook"
  /** A subagent the agent can delegate to. */
  | "subagent"
  /** The active output style. */
  | "output-style"
  /** The provider's own system prompt and built-in tools: shapes the context, never removable. */
  | "system"
  /** The thread's conversation so far: carried by a fork, dropped by a fresh spawn. */
  | "conversation";

export const KIND_LABELS: Record<ArtifactKind, string> = {
  instruction: "Instructions",
  memory: "Memory",
  skill: "Skills",
  "mcp-server": "MCP servers",
  tool: "Plugin tools",
  hook: "Hooks",
  subagent: "Subagents",
  "output-style": "Output style",
  system: "System",
  conversation: "Conversation",
};

/**
 * Who puts an artifact into the context. This decides which lever can take it out: the host (bb) that adds
 * instructions, skills and tools to every provider, or the provider process itself from its own files.
 */
export type Injector = "host" | "provider";

/** Where artifacts are defined: a settings layer, a plugin, a file. */
export type Source = {
  /** Stable within a composition, e.g. `src:Claude Code user`. */
  id: string;
  label: string;
  injector: Injector;
  scope: "builtin" | "user" | "project" | "local" | "managed" | "plugin" | "remote" | "thread";
};

/** A token weight, and whether the host reported it or it is estimated from a size. */
export type Tokens = { value: number | null; basis: "reported" | "estimated" };

export type Artifact = {
  /** Stable across inventories of one workspace: `<kind>:<source id>:<name>`. Decisions are keyed by it. */
  id: string;
  kind: ArtifactKind;
  name: string;
  sourceId: string;
  description?: string;
  tokens: Tokens;
  path?: string;
  /** Whether it reaches the agent now (a shadowed or other-provider skill is listed but inactive). */
  active: boolean;
  /** Loaded on demand rather than at start (deferred MCP tools behind tool search). */
  deferred?: boolean;
  /** A short fact worth showing: a status, a tool count. */
  detail?: string;
};

/** What a composition was taken from. */
export type Basis = {
  threadId: string | null;
  providerId: string;
  providerName: string;
  model: string | null;
  workspace: string | null;
};

/** Everything that feeds one agent, as one host reported it at one moment. */
export type Composition = {
  basis: Basis;
  builtAt: number;
  sources: Source[];
  artifacts: Artifact[];
  /** The context the provider reports in use, when it reports one. */
  context: { usedTokens: number; window: number } | null;
  problems: string[];
};

/** Keep an active artifact (the default) or leave it out; include an inactive one. */
export type Decision = "include" | "exclude";

/** Decisions over a composition, plus what to add. Only departures from the composition are stored. */
export type Manifest = {
  version: 1;
  id: string;
  title: string;
  /** The thread whose composition it was made on, for reopening; a manifest applies to any composition. */
  basisThreadId: string | null;
  decisions: Record<string, Decision>;
  additions: { instructions: string };
  createdAt: number;
  updatedAt: number;
};

export function emptyManifest(input: { id: string; title: string; basisThreadId: string | null; now: number }): Manifest {
  return { version: 1, id: input.id, title: input.title, basisThreadId: input.basisThreadId, decisions: {}, additions: { instructions: "" }, createdAt: input.now, updatedAt: input.now };
}

// ------------------------------------------------------------------ ids

export const sourceId = (label: string): string => `src:${label}`;
export const artifactId = (kind: ArtifactKind, source: string, name: string): string => `${kind}:${source}:${name}`;

// ------------------------------------------------------------------ resolving decisions

/** Whether an artifact reaches the agent under a manifest. Decisions on what no lever removes are ignored. */
export function isIncluded(a: Artifact, m: Manifest): boolean {
  if (!isRemovable(a)) return a.active;
  const d = m.decisions[a.id];
  return d === undefined ? a.active : d === "include";
}

/** Whether a decision departs from the artifact's current state, i.e. whether it means a change. */
export function isChange(a: Artifact, d: Decision | undefined): boolean {
  return d !== undefined && (d === "include") !== a.active;
}

/**
 * Set one decision; a decision equal to the current state is dropped, so manifests stay minimal. What no lever removes
 * (the system prompt, the conversation) takes no decision.
 */
export function decide(m: Manifest, a: Artifact, d: Decision, now: number): Manifest {
  const decisions = { ...m.decisions };
  if (isChange(a, d) && isRemovable(a)) decisions[a.id] = d;
  else delete decisions[a.id];
  return { ...m, decisions, updatedAt: now };
}

/** Toggle a source's active artifacts at once: all out when any is in, else back to how the source has them. */
export function decideSource(m: Manifest, c: Composition, source: string, now: number): Manifest {
  const own = c.artifacts.filter(a => a.sourceId === source && a.active && isRemovable(a));
  const anyOn = own.some(a => isIncluded(a, m));
  return own.reduce((acc, a) => decide(acc, a, anyOn ? "exclude" : "include", now), m);
}

/** Artifacts no lever on any host can take out: the provider's own system prompt, the conversation. */
export function isRemovable(a: Artifact): boolean {
  return a.kind !== "system" && a.kind !== "conversation";
}

export const tokensOf = (a: Artifact): number => a.tokens.value ?? 0;

/** Tokens it takes at session start: a deferred artifact (MCP tools behind tool search) loads only when used. */
export const startTokensOf = (a: Artifact): number => (a.deferred === true ? 0 : tokensOf(a));

// ------------------------------------------------------------------ diff

export type Diff = {
  removed: Artifact[];
  added: Artifact[];
  tokensRemoved: number;
  tokensAdded: number;
  /** Decisions naming artifacts this composition does not have: the workspace changed since the manifest was made. */
  unknown: string[];
};

/** What applying a manifest to a composition changes. */
export function diff(c: Composition, m: Manifest): Diff {
  const byId = new Map(c.artifacts.map(a => [a.id, a]));
  const removed: Artifact[] = [];
  const added: Artifact[] = [];
  const unknown: string[] = [];
  for (const [id, d] of Object.entries(m.decisions)) {
    const a = byId.get(id);
    if (a === undefined) {
      unknown.push(id);
      continue;
    }
    if (!isChange(a, d) || !isRemovable(a)) continue;
    (d === "exclude" ? removed : added).push(a);
  }
  const sum = (xs: Artifact[]) => xs.reduce((n, a) => n + tokensOf(a), 0);
  return { removed, added, tokensRemoved: sum(removed), tokensAdded: sum(added), unknown };
}

/** How two manifests differ, per artifact: the advisor's proposal preview lists these before it is applied. */
export function diffManifests(a: Manifest, b: Manifest): { id: string; from: Decision | undefined; to: Decision | undefined }[] {
  const ids = new Set([...Object.keys(a.decisions), ...Object.keys(b.decisions)]);
  return [...ids].filter(id => a.decisions[id] !== b.decisions[id]).map(id => ({ id, from: a.decisions[id], to: b.decisions[id] }));
}

/**
 * Token totals under a manifest: what is kept at session start, what is dropped, what is kept but loads only on
 * demand, and how many kept artifacts have no known weight.
 */
export function totals(c: Composition, m: Manifest): { included: number; excluded: number; onDemand: number; unknownWeight: number } {
  let included = 0;
  let excluded = 0;
  let onDemand = 0;
  let unknownWeight = 0;
  for (const a of c.artifacts) {
    const kept = isIncluded(a, m);
    if (a.tokens.value === null) {
      if (kept) unknownWeight += 1;
      continue;
    }
    if (kept && a.deferred === true) onDemand += a.tokens.value;
    else if (kept) included += a.tokens.value;
    else if (a.active) excluded += a.tokens.value;
  }
  return { included, excluded, onDemand, unknownWeight };
}

/** The most a manifest may hold. Larger ones are refused, not cut: a cut manifest would mean something else. */
export const MANIFEST_LIMITS = { id: 200, title: 200, decisions: 5000, decisionKey: 1000, instructions: 16_000 } as const;

/** A manifest read from storage or an RPC: checked field by field, unknown fields dropped, over-limit ones refused. */
export function parseManifest(v: unknown): Manifest | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const L = MANIFEST_LIMITS;
  if (o.version !== 1 || typeof o.id !== "string" || typeof o.title !== "string") return null;
  if (o.id === "" || o.id.length > L.id || o.title.length > L.title) return null;
  const decisions: Record<string, Decision> = {};
  if (typeof o.decisions === "object" && o.decisions !== null) {
    const entries = Object.entries(o.decisions as Record<string, unknown>);
    if (entries.length > L.decisions) return null;
    for (const [k, d] of entries) if (k.length <= L.decisionKey && (d === "include" || d === "exclude")) decisions[k] = d;
  }
  const add = (typeof o.additions === "object" && o.additions !== null ? o.additions : {}) as Record<string, unknown>;
  if (typeof add.instructions === "string" && add.instructions.length > L.instructions) return null;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return {
    version: 1,
    id: o.id,
    title: o.title,
    basisThreadId: typeof o.basisThreadId === "string" ? o.basisThreadId : null,
    decisions,
    additions: { instructions: typeof add.instructions === "string" ? add.instructions : "" },
    createdAt: num(o.createdAt),
    updatedAt: num(o.updatedAt),
  };
}
