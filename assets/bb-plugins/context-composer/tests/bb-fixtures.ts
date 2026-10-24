// agent-artifacts answers, as plain data, for the adapter and server tests.
import type { ClaudeInventory } from "../../agent-artifacts/lib/claude.ts";
import type { Inventory } from "../../agent-artifacts/lib/inventory.ts";

export function inventory(providerId: string): Inventory {
  return {
    builtAt: 1,
    thread: { id: "thr_1", title: "t", providerId, providerName: providerId === "codex" ? "Codex" : "Claude Code", providerAvailable: true, options: null, model: "m" },
    environment: { id: "env", path: "/w", hostId: "h", branchName: null, isWorktree: false, isGitRepo: true, environmentProviderId: null, status: "ready" },
    context: {
      usedTokens: 5000,
      window: 100000,
      estimated: false,
      model: "m",
      autoCompactAtTokens: null,
      ratio: 0.05,
      categories: [
        { id: "sys", label: "System prompt", kind: "used", tokens: 3000, entries: [] },
        { id: "msg", label: "Messages", kind: "used", tokens: 1500, entries: [] },
        { id: "free", label: "Free space", kind: "free", tokens: 95000, entries: [] },
      ],
    },
    instructions: [
      { label: "bb user instructions", kind: "bb-user", path: "/h/.bb/AGENTS.md", hostId: "h", sizeBytes: 400, approxTokens: 100 },
      { label: "Codex project instructions", kind: "provider", path: "/w/AGENTS.md", hostId: "h", sizeBytes: 800, approxTokens: 200 },
      { label: "environment setup hook", kind: "env-hook", path: "/w/.bb-env-setup.sh", hostId: "h", sizeBytes: 10, approxTokens: 3 },
    ],
    missingInstructions: [],
    skills: [
      { id: "1", name: "workflows", description: "run workflows", source: "bb plugin workflows", scope: "plugin", tier: "bb", status: "active", filePath: "/p/SKILL.md" },
      { id: "2", name: "tdd", description: "test first", source: "Codex user", scope: "provider-user", tier: "provider", status: "active", filePath: "/h/.codex/skills/tdd/SKILL.md" },
      { id: "3", name: "tdd", description: "old", source: "Claude Code user", scope: "provider-user", tier: "other-provider", status: "other-provider", filePath: "/x" },
      { id: "4", name: "dup", description: "", source: "bb user", scope: "bb-user", tier: "bb", status: "shadowed", shadowedBy: "bb project", filePath: "/y" },
    ],
    tools: [{ name: "kb_call", detail: "call kb", pluginId: "kb", pluginName: "kb" }],
    cliCommands: [],
    plugins: [],
    counts: { activeSkills: 2, tools: 1, cliCommands: 0, instructions: 2, pluginProblems: 0 },
    problems: [],
  };
}

export const claude = (): ClaudeInventory => ({
  cwd: "/w",
  probedAt: 1,
  probeMs: 1,
  isLive: true,
  version: "2.1.310",
  account: null,
  baseline: { totalTokens: 26000, maxTokens: 400000, model: "opus" },
  groups: [
    { kind: "skills", title: "Skills", icon: "", items: [
      { id: "a#0", name: "tdd", source: "user", tokens: 40, path: "/h/.claude/skills/tdd/SKILL.md" },
      { id: "b#1", name: "bb-global-skills:kb", source: "plugin bb-global-skills", tokens: 60, path: "/var/folders/x/bb-provider-bridge-provider-claude-code-1/skills/kb/SKILL.md" },
      { id: "c#2", name: "simplify", source: "built-in", tokens: 30 },
    ] },
    { kind: "mcp", title: "MCP", icon: "", items: [
      { id: "kb", name: "kb", source: "user", status: "connected", tokens: 5000 },
      { id: "gh", name: "github", source: "user", status: "failed" },
    ] },
    { kind: "instructions", title: "CLAUDE.md", icon: "", items: [{ id: "/w/CLAUDE.md", name: "/w/CLAUDE.md", source: "project", path: "/w/CLAUDE.md", tokens: 1200 }] },
    { kind: "memory", title: "Memory", icon: "", items: [
      { id: "m1", name: "MEMORY.md", source: "auto memory", status: "on", tokens: 300 },
      { id: "m2", name: "notes.md", source: "auto memory", detail: "read on demand", path: "/h/m/notes.md" },
    ] },
    { kind: "outputStyle", title: "Output style", icon: "", items: [
      { id: "default", name: "default", source: "built-in", status: "on" },
      { id: "explain", name: "explain", source: "built-in", status: "off" },
    ] },
    { kind: "env", title: "Env", icon: "", items: [{ id: "user:X", name: "X", source: "user" }] },
  ],
  attention: [],
  problems: [],
});

