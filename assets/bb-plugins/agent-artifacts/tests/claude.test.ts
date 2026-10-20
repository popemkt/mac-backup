// Claude Code's own view, over plain data. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClaudeInventory, claudeMarkdown, endpoint, mergeSettings, type ClaudeLive, type ClaudeProbe, type LiveMcp } from "../lib/claude.ts";

function live(over: Partial<ClaudeLive> = {}): ClaudeLive {
  return {
    version: "2.1.0",
    account: { email: "me@example.com", subscriptionType: "max" },
    permissionMode: "default",
    outputStyle: "default",
    outputStyles: ["default", "Explanatory"],
    models: [],
    commands: [],
    agents: [],
    mcp: [],
    mcpSettled: true,
    context: null,
    ...over,
  };
}

function probe(over: Partial<ClaudeProbe> = {}): ClaudeProbe {
  return {
    cwd: "/w",
    home: "/h",
    configDir: "/h/.claude",
    live: live(),
    settings: {},
    settingsPaths: {},
    disk: {
      installed: {},
      marketplaces: {},
      userMcp: {},
      localMcp: {},
      projectMcp: {},
      approvals: { enabled: [], disabled: [], enableAll: false },
      plugins: {},
      outputStyles: [],
      memory: null,
    },
    problems: [],
    probedAt: 0,
    probeMs: 0,
    ...over,
  };
}

function server(over: Partial<LiveMcp>): LiveMcp {
  return { name: "s", status: "connected", scope: "user", source: "user", transport: "stdio", endpoint: "node", error: null, server: null, tools: [], ...over };
}

const groupOf = (s: ClaudeProbe, kind: string) => buildClaudeInventory(s).groups.find(g => g.kind === kind)!;

test("settings merge: later sources win; enabledPlugins and env merge key by key", () => {
  const merged = mergeSettings({
    user: { model: "a", env: { A: "1" }, enabledPlugins: { "x@m": true } },
    project: { model: "b", env: { B: "2" }, enabledPlugins: { "y@m": true } },
    policy: { enabledPlugins: { "x@m": false } },
  });
  assert.equal(merged.model, "b");
  assert.deepEqual(merged.env, { A: "1", B: "2" });
  assert.deepEqual(merged.enabledPlugins, { "x@m": false, "y@m": true });
});

test("an MCP endpoint never carries credentials: a URL's origin, a command's program name", () => {
  assert.equal(endpoint({ url: "https://user:secret@api.example.com/mcp?token=abc" }), "https://api.example.com");
  assert.equal(endpoint({ command: "/usr/local/bin/uvx" }), "uvx");
  assert.equal(endpoint({ url: "not a url" }), "");
});

test("MCP: live status per server, plugin servers named and sourced by their plugin, unapproved project servers from disk", () => {
  const s = probe({
    live: live({
      mcp: [
        server({ name: "tana", status: "connected", tools: [{ name: "search", description: null }, { name: "read", description: null }] }),
        server({ name: "plugin:github:github", status: "failed", source: "plugin", scope: "dynamic", error: "401" }),
        server({ name: "claude.ai Docs", status: "needs-auth", source: "claudeai", scope: "claudeai" }),
      ],
    }),
    disk: { ...probe().disk, projectMcp: { local: { command: "node" }, gone: { command: "x" } }, approvals: { enabled: [], disabled: ["gone"], enableAll: false } },
    settings: { user: { enabledPlugins: { "github@official": true } } },
  });
  const inv = buildClaudeInventory(s);
  const mcp = inv.groups.find(g => g.kind === "mcp")!;
  const by = Object.fromEntries(mcp.items.map(i => [i.id, i]));
  assert.equal(by["tana"]!.status, "connected");
  assert.deepEqual(by["tana"]!.list, ["search", "read"]);
  assert.match(by["tana"]!.detail!, /2 tools/);
  assert.equal(by["plugin:github:github"]!.name, "github");
  assert.equal(by["plugin:github:github"]!.source, "plugin github@official");
  assert.equal(by["plugin:github:github"]!.description, "401");
  assert.equal(by["claude.ai Docs"]!.source, "claude.ai");
  assert.equal(by["local"]!.status, "pending");
  assert.equal(by["local"]!.fromDisk, true);
  assert.equal(by["gone"]!.status, "disabled");
  assert.deepEqual(inv.attention, ["MCP github failed: 401", "MCP claude.ai Docs needs sign-in (/mcp in Claude Code)", "MCP local in .mcp.json is awaiting approval"]);
});

test("without a live session, MCP servers come from config files with no connection state", () => {
  const s = probe({ live: null, disk: { ...probe().disk, userMcp: { a: { url: "https://x.dev/mcp" } } } });
  const mcp = groupOf(s, "mcp");
  assert.deepEqual(mcp.items.map(i => [i.name, i.status, i.detail]), [["a", undefined, "http https://x.dev"]]);
  assert.match(mcp.note!, /did not start/);
  assert.equal(buildClaudeInventory(s).isLive, false);
});

test("hooks: one item per hook, from every settings source and each enabled plugin's hooks.json", () => {
  const s = probe({
    settings: {
      user: { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }, { type: "http", url: "https://h" }] }] } },
      local: { hooks: { Stop: [{ hooks: [{ type: "command", command: "ding" }] }] } },
    },
    disk: { ...probe().disk, plugins: { "p@m": { name: "p", root: "/r", hooks: { SessionStart: [{ hooks: [{ type: "command", command: "hi" }] }] } } } },
  });
  const hooks = groupOf(s, "hooks");
  assert.deepEqual(
    hooks.items.map(i => [i.name, i.source, i.detail]),
    [
      ["PreToolUse", "user", "[Bash] command: guard.sh"],
      ["PreToolUse", "user", "[Bash] http: https://h"],
      ["Stop", "local", "command: ding"],
      ["SessionStart", "plugin p@m", "command: hi"],
    ],
  );
  assert.equal(hooks.items[3]!.fromDisk, true);
});

test("skills, agents and commands: sources from the session; skills are not repeated as commands", () => {
  const s = probe({
    live: live({
      commands: [
        { name: "review", description: "Review code", argumentHint: "", builtin: false },
        { name: "help", description: "Help", argumentHint: "", builtin: true },
        { name: "ce:plan", description: "Plan", argumentHint: "<topic>", builtin: false },
        { name: "mine", description: "Mine", argumentHint: "", builtin: false },
      ],
      agents: [
        { name: "Explore", description: "Search", model: null },
        { name: "ce:reviewer", description: "Reviews", model: "haiku" },
      ],
      context: {
        totalTokens: 100,
        maxTokens: 1000,
        model: "m",
        autoCompactAt: null,
        categories: [],
        memoryFiles: [
          { path: "/h/.claude/CLAUDE.md", type: "User", tokens: 5 },
          { path: "/h/.claude/projects/-w/memory/MEMORY.md", type: "AutoMem", tokens: 7 },
        ],
        mcpTools: [],
        agents: [{ agentType: "ce:reviewer", source: "plugin", pluginId: "ce@market", path: "/a.md", tokens: 9 }],
        skills: { total: 3, included: 1, items: [{ name: "review", source: "userSettings", pluginName: null, pluginId: null, path: "/h/.claude/skills/review/SKILL.md", tokens: 12 }] },
      },
    }),
    settings: { user: { enabledPlugins: { "ce@market": true } } },
  });
  const inv = buildClaudeInventory(s);
  const get = (kind: string) => inv.groups.find(g => g.kind === kind)!;
  assert.deepEqual(get("skills").items.map(i => [i.name, i.source, i.description, i.tokens]), [["review", "user", "Review code", 12]]);
  assert.match(get("skills").note!, /2 more skills/);
  assert.deepEqual(get("agents").items.map(i => [i.name, i.source, i.detail]), [["ce:reviewer", "plugin ce@market", "model haiku"], ["Explore", "built-in", undefined]]);
  assert.deepEqual(get("commands").items.map(i => [i.name, i.source]), [["/ce:plan", "plugin ce@market"], ["/help", "built-in"], ["/mine", "custom"]]);
  assert.deepEqual(get("instructions").items.map(i => [i.name, i.source]), [["~/.claude/CLAUDE.md", "user"]]);
  assert.deepEqual(get("memory").items.map(i => [i.name, i.detail]), [["~/.claude/projects/-w/memory/MEMORY.md", "in context"]]);
  assert.deepEqual(inv.baseline, { totalTokens: 100, maxTokens: 1000, model: "m" });
});

test("permissions deny before ask before allow per source; env values masked in Markdown", () => {
  const s = probe({
    settings: {
      user: { permissions: { allow: ["Read"], deny: ["Bash(rm:*)"], defaultMode: "plan" }, env: { TOKEN: "sk-secret-123" } },
      project: { permissions: { ask: ["WebFetch"] } },
    },
  });
  const inv = buildClaudeInventory(s);
  assert.deepEqual(
    inv.groups.find(g => g.kind === "permissions")!.items.map(i => [i.name, i.source, i.detail]),
    [
      ["Bash(rm:*)", "user", "deny"],
      ["Read", "user", "allow"],
      ["defaultMode plan", "user", "mode"],
      ["WebFetch", "project", "ask"],
    ],
  );
  const md = claudeMarkdown(inv, { full: true });
  assert.doesNotMatch(md, /sk-secret-123/);
  assert.match(md, /- TOKEN \(user\): •{8} \(13 chars\)/);
});

test("plugins: enabled state from merged settings, installed-but-unnamed ones listed off, mods only when a plugin ships modules", () => {
  const s = probe({
    settings: { user: { enabledPlugins: { "a@m": true, "b@m": false } } },
    disk: {
      ...probe().disk,
      installed: { "a@m": [{ scope: "user", version: "1.0.0" }], "c@m": [{ scope: "user" }], "d@m": [{ scope: "project", projectPath: "/elsewhere" }] },
      plugins: { "a@m": { name: "a", root: "/p/a", version: "1.2.0", modules: ["hooks/mod.js"] } },
    },
  });
  const inv = buildClaudeInventory(s);
  assert.deepEqual(
    inv.groups.find(g => g.kind === "plugins")!.items.map(i => [i.name, i.status, i.detail]),
    [
      ["a@m", "on", "v1.2.0"],
      ["b@m", "off", "not installed"],
      ["c@m", "off", "installed, not in enabledPlugins"],
    ],
  );
  assert.deepEqual(inv.groups.find(g => g.kind === "mods")!.items.map(i => i.name), ["a"]);
  assert.equal(buildClaudeInventory(probe()).groups.some(g => g.kind === "mods"), false);
});

test("output style: the session's active style first, then its other styles and style files", () => {
  const s = probe({ disk: { ...probe().disk, outputStyles: [{ name: "Terse", source: "user", path: "/h/.claude/output-styles/Terse.md" }] } });
  assert.deepEqual(
    groupOf(s, "outputStyle").items.map(i => [i.name, i.status, i.source]),
    [
      ["default", "on", "built-in"],
      ["Explanatory", "off", "built-in"],
      ["Terse", "off", "user"],
    ],
  );
});
