// The bb adapter's way in: agent-artifacts' inventory of a thread (and, for Claude Code threads, Claude Code's own
// view of the workspace) mapped onto the composition model. agent-artifacts owns gathering; this file only
// translates, so there is one inventory and no second reader of bb's state. Pure, tested over plain data.
import type { ClaudeInventory, Group, Item } from "../../agent-artifacts/lib/claude";
import type { Inventory } from "../../agent-artifacts/lib/inventory";
import { artifactId, sourceId, type Artifact, type ArtifactKind, type Composition, type Source, type Tokens } from "../core/model.ts";

const estimated = (chars: number): Tokens => ({ value: Math.ceil(chars / 4), basis: "estimated" });
const reported = (n: number | undefined): Tokens => (n === undefined ? { value: null, basis: "reported" } : { value: n, basis: "reported" });

class Builder {
  readonly sources = new Map<string, Source>();
  readonly artifacts = new Map<string, Artifact>();

  source(label: string, injector: Source["injector"], scope: Source["scope"]): string {
    const id = sourceId(label);
    if (!this.sources.has(id)) this.sources.set(id, { id, label, injector, scope });
    return id;
  }

  add(a: Omit<Artifact, "id">): void {
    const id = artifactId(a.kind, a.sourceId, a.name);
    // One artifact per id: a name listed twice by one source (a skill and its alias) is one context entry.
    if (!this.artifacts.has(id)) this.artifacts.set(id, { id, ...a });
  }
}

/** Claude Code's word for a source, as lib/claude.ts labels items, to a scope. */
function claudeScope(source: string): Source["scope"] {
  if (source === "built-in") return "builtin";
  if (source === "user" || source === "project" || source === "local" || source === "managed") return source;
  if (source.startsWith("plugin ")) return "plugin";
  if (source === "claude.ai" || source === "claude.ai sync") return "remote";
  return "user";
}

/** bb gives Claude Code its own skills through an injected plugin; those are bb's, not Claude Code's. */
const isBbInjected = (i: Item) => /bb-global-skills|bb-claude-skill-plugins|bb-provider-bridge/.test(`${i.source} ${i.path ?? ""}`);

const CLAUDE_KINDS: Partial<Record<Group["kind"], ArtifactKind>> = {
  skills: "skill",
  agents: "subagent",
  mcp: "mcp-server",
  hooks: "hook",
  instructions: "instruction",
  memory: "memory",
  outputStyle: "output-style",
};

const INACTIVE = new Set(["off", "disabled", "pending", "failed", "needs-auth"]);

function fromClaude(b: Builder, claude: ClaudeInventory): void {
  for (const g of claude.groups) {
    const kind = CLAUDE_KINDS[g.kind];
    if (kind === undefined) continue;
    for (const i of g.items) {
      // Inactive: an output style not in use, auto-memory read only on demand, MCP servers that did not connect.
      const active = !(INACTIVE.has(i.status ?? "") || (kind === "memory" && i.detail === "read on demand"));
      if (kind === "output-style" && !active) continue;
      const bb = kind === "skill" && isBbInjected(i);
      const label = bb ? "bb skills (via Claude Code)" : `Claude Code ${i.source}`;
      const src = b.source(label, bb ? "host" : "provider", bb ? "plugin" : claudeScope(i.source));
      b.add({
        kind,
        name: i.name,
        sourceId: src,
        ...(i.description === undefined ? {} : { description: i.description }),
        tokens: kind === "hook" ? { value: 0, basis: "estimated" } : reported(i.tokens),
        ...(i.path === undefined ? {} : { path: i.path }),
        active,
        ...(kind === "mcp-server" ? { deferred: true } : {}),
        ...(i.detail === undefined ? {} : { detail: i.detail }),
      });
    }
  }
}

/** The composition of one thread. `claude` is Claude Code's own view, when the thread runs Claude Code. */
export function compositionFrom(inv: Inventory, claude: ClaudeInventory | null, builtAt: number): Composition {
  const b = new Builder();
  const provider = inv.thread.providerName;
  const hasClaude = claude !== null && claude.isLive;

  for (const i of inv.instructions) {
    if (i.kind === "env-hook") continue;
    // Claude Code reports the files it loads itself, with token counts; bb's guesses at them would double them.
    if (i.kind === "provider" && hasClaude) continue;
    const host = i.kind === "bb-user" || i.kind === "bb-workspace";
    const src = b.source(host ? "bb instructions" : `${provider} instructions`, host ? "host" : "provider", i.kind === "bb-user" ? "user" : "project");
    b.add({ kind: "instruction", name: i.label, sourceId: src, path: i.path, tokens: i.approxTokens === null ? { value: null, basis: "estimated" } : { value: i.approxTokens, basis: "estimated" }, active: true, ...(i.note === undefined ? {} : { detail: i.note }) });
  }

  for (const s of inv.skills) {
    // With Claude Code's own listing, it is the truth for what loads (bb's skills included, through bb's plugin).
    if (hasClaude || s.tier === "other-provider") continue;
    const host = s.tier === "bb";
    const src = b.source(host ? `bb ${s.source.replace(/^bb /, "")}` : s.source, host ? "host" : "provider", s.scope === "plugin" ? "plugin" : s.scope.endsWith("project") ? "project" : s.scope === "bb-builtin" ? "builtin" : "user");
    b.add({
      kind: "skill",
      name: s.name,
      sourceId: src,
      description: s.description,
      path: s.filePath,
      tokens: estimated(s.name.length + s.description.length + 24),
      active: s.status === "active",
      ...(s.status === "active" ? {} : { detail: s.status === "shadowed" ? `shadowed by ${s.shadowedBy ?? "?"}` : s.status }),
    });
  }

  for (const t of inv.tools) {
    const src = b.source(`bb plugin ${t.pluginName}`, "host", "plugin");
    b.add({ kind: "tool", name: t.name, sourceId: src, description: t.detail, tokens: estimated(t.name.length + t.detail.length + 40), active: true });
  }

  if (claude !== null) fromClaude(b, claude);

  // What no lever removes: the provider's own prompt and tools, and the conversation, as the provider reports them.
  for (const cat of inv.context?.categories ?? []) {
    if (cat.kind !== "used") continue;
    const isConversation = /message|conversation/i.test(cat.label);
    const isSystem = /^system/i.test(cat.label);
    if (!isConversation && !isSystem) continue;
    const src = b.source(isConversation ? "this thread" : `${provider} system`, "provider", isConversation ? "thread" : "builtin");
    b.add({ kind: isConversation ? "conversation" : "system", name: cat.label, sourceId: src, tokens: reported(cat.tokens), active: true });
  }

  const problems = [...inv.problems, ...(claude?.problems ?? [])];
  if (claude !== null && !claude.isLive) problems.push("Claude Code did not start for the probe: its skills, subagents and instruction files are missing.");
  return {
    basis: { threadId: inv.thread.id, providerId: inv.thread.providerId, providerName: provider, model: inv.thread.model, workspace: inv.environment?.path ?? null },
    builtAt,
    sources: [...b.sources.values()],
    artifacts: [...b.artifacts.values()],
    context: inv.context === null ? null : { usedTokens: inv.context.usedTokens, window: inv.context.window },
    problems,
  };
}
