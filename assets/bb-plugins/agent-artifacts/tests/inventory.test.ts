// The inventory's rules, over plain data. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildInventory,
  healthOf,
  homeFromDataDir,
  instructionCandidates,
  inventoryMarkdown,
  resolveSkills,
  skillSource,
  type PluginRecord,
  type SkillRecord,
  type Snapshot,
} from "../lib/inventory.ts";

const NAMES = { "claude-code": "Claude Code", codex: "Codex" };

let seq = 0;
function skill(over: Partial<SkillRecord>): SkillRecord {
  seq += 1;
  return { id: `s${seq}`, name: "x", description: "d", filePath: `/p/${seq}/SKILL.md`, scope: "plugin", provider: null, pluginId: "p", ...over };
}

function plugin(over: Partial<PluginRecord>): PluginRecord {
  return {
    id: "p",
    name: "P",
    description: null,
    enabled: true,
    status: "running",
    statusDetail: null,
    provenance: "builtin",
    version: "1.0.0",
    icon: null,
    providerIds: [],
    capabilities: [],
    cliCommand: null,
    services: [],
    schedules: [],
    hasApp: false,
    ...over,
  };
}

function snap(over: Partial<Snapshot>): Snapshot {
  return {
    thread: { id: "thr_1", title: "T", providerId: "claude-code", projectId: "proj_1" },
    provider: { id: "claude-code", displayName: "Claude Code", available: true },
    options: null,
    environment: null,
    context: null,
    skills: [],
    plugins: [],
    providerNames: NAMES,
    files: [],
    problems: [],
    ...over,
  };
}

test("labels each skill by who defines it", () => {
  assert.equal(skillSource({ scope: "plugin", provider: null, pluginId: "workflows" }, NAMES), "bb plugin workflows");
  assert.equal(skillSource({ scope: "plugin", provider: "claude-code", pluginId: "caveman" }, NAMES), "Claude Code plugin caveman");
  assert.equal(skillSource({ scope: "provider-user", provider: "codex", pluginId: null }, NAMES), "Codex user");
  assert.equal(skillSource({ scope: "provider-project", provider: "acp-x", pluginId: null }, NAMES), "acp-x project");
  assert.equal(skillSource({ scope: "bb-project", provider: null, pluginId: null }, NAMES), "bb project");
});

test("bb skills reach every provider, native skills only their own, others are listed apart", () => {
  const skills = resolveSkills(
    [
      skill({ name: "bb-one", scope: "plugin", provider: null }),
      skill({ name: "mine", scope: "provider-user", provider: "claude-code", pluginId: null }),
      skill({ name: "theirs", scope: "provider-user", provider: "codex", pluginId: null }),
    ],
    "claude-code",
    NAMES,
  );
  const by = Object.fromEntries(skills.map(s => [s.name, s]));
  assert.equal(by["bb-one"]!.tier, "bb");
  assert.equal(by["bb-one"]!.status, "active");
  assert.equal(by["mine"]!.tier, "provider");
  assert.equal(by["mine"]!.status, "active");
  assert.equal(by["theirs"]!.status, "other-provider");
});

test("a bb project skill shadows a user and a plugin skill of the same name", () => {
  const skills = resolveSkills(
    [
      skill({ name: "dup", scope: "plugin", pluginId: "a" }),
      skill({ name: "dup", scope: "bb-user", pluginId: null }),
      skill({ name: "dup", scope: "bb-project", pluginId: null }),
    ],
    "claude-code",
    NAMES,
  );
  const status = Object.fromEntries(skills.map(s => [s.scope, s]));
  assert.equal(status["bb-project"]!.status, "active");
  assert.equal(status["bb-user"]!.status, "shadowed");
  assert.equal(status["bb-user"]!.shadowedBy, "bb project");
  assert.equal(status["plugin"]!.status, "shadowed");
});

test("two skills of one name in one bb source collide; across tiers they are only duplicates", () => {
  const skills = resolveSkills(
    [
      skill({ name: "same", scope: "bb-user", pluginId: null }),
      skill({ name: "same", scope: "bb-user", pluginId: null }),
      skill({ name: "both", scope: "plugin", pluginId: "w" }),
      skill({ name: "both", scope: "provider-user", provider: "claude-code", pluginId: null }),
    ],
    "claude-code",
    NAMES,
  );
  assert.deepEqual(skills.filter(s => s.name === "same").map(s => s.status), ["collision", "collision"]);
  const both = skills.filter(s => s.name === "both");
  assert.deepEqual(both.map(s => s.status), ["active", "active"]);
  assert.deepEqual(both.find(s => s.tier === "bb")!.alsoIn, ["Claude Code user"]);
  assert.deepEqual(both.find(s => s.tier === "provider")!.alsoIn, ["bb plugin w"]);
});

test("same-rank duplicates from two different bb plugins are not called a collision", () => {
  const skills = resolveSkills([skill({ name: "n", pluginId: "a" }), skill({ name: "n", pluginId: "b" })], "claude-code", NAMES);
  assert.deepEqual(skills.map(s => s.status), ["active", "active"]);
});

test("plugin health: off, error, degraded service, ok", () => {
  assert.equal(healthOf({ enabled: false, status: "disabled", services: [] }), "off");
  assert.equal(healthOf({ enabled: true, status: "failed", services: [] }), "error");
  assert.equal(healthOf({ enabled: true, status: "degraded", services: [] }), "warning");
  assert.equal(healthOf({ enabled: true, status: "running", services: [{ name: "w", state: "crashed" }] }), "warning");
  assert.equal(healthOf({ enabled: true, status: "running", services: [{ name: "w", state: "running" }] }), "ok");
});

test("tools and commands come only from running plugins; the thread's provider plugin sorts first", () => {
  const inv = buildInventory(
    snap({
      plugins: [
        plugin({ id: "wf", name: "Workflows", capabilities: [{ kind: "agent-tool", id: "run", label: "bb_workflow_run", detail: "Run it" }], cliCommand: { name: "workflows", summary: "Run workflows" } }),
        plugin({ id: "dead", name: "Dead", status: "failed", capabilities: [{ kind: "agent-tool", id: "t", label: "dead_tool", detail: null }] }),
        plugin({ id: "cc", name: "Claude provider", providerIds: ["claude-code"] }),
        plugin({ id: "ui", name: "Editor", hasApp: true }),
      ],
    }),
    0,
  );
  assert.deepEqual(inv.tools.map(t => t.name), ["bb_workflow_run"]);
  assert.deepEqual(inv.cliCommands.map(c => c.command), ["bb workflows"]);
  assert.equal(inv.plugins[0]!.id, "cc");
  assert.equal(inv.plugins[0]!.isThreadProvider, true);
  assert.equal(inv.plugins.find(p => p.id === "ui")!.reachesAgent, false);
  assert.equal(inv.counts.pluginProblems, 1);
});

test("instruction candidates follow the provider; home only when bb's data dir is ~/.bb", () => {
  assert.equal(homeFromDataDir("/Users/me/.bb"), "/Users/me");
  assert.equal(homeFromDataDir("/srv/bb-data"), null);
  const cc = instructionCandidates({ providerId: "claude-code", dataDir: "/h/.bb", serverHostId: "h1", workspace: "/w", workspaceHostId: "h1", home: "/h" });
  assert.deepEqual(
    cc.map(c => c.path),
    ["/h/.bb/AGENTS.md", "/w/.bb/AGENTS.md", "/h/.claude/CLAUDE.md", "/w/CLAUDE.md", "/w/.claude/CLAUDE.md", "/w/CLAUDE.local.md", "/w/AGENTS.md", "/w/.bb-env-setup.sh", "/w/.bb-env-teardown.sh"],
  );
  const codex = instructionCandidates({ providerId: "codex", dataDir: null, serverHostId: null, workspace: "/w", workspaceHostId: "h2", home: null });
  assert.deepEqual(codex.map(c => c.path), ["/w/.bb/AGENTS.md", "/w/AGENTS.md", "/w/.bb-env-setup.sh", "/w/.bb-env-teardown.sh"]);
  assert.ok(codex.every(c => c.hostId === "h2"));
});

test("found files become instructions with rough tokens; missing ones are kept as checked", () => {
  const inv = buildInventory(
    snap({
      files: [
        { label: "bb user instructions", kind: "bb-user", path: "/h/.bb/AGENTS.md", hostId: "h1", exists: true, sizeBytes: 400, note: "every provider" },
        { label: "Claude Code project memory", kind: "provider", path: "/w/CLAUDE.md", hostId: "h1", exists: false, sizeBytes: null },
        { label: "environment setup hook", kind: "env-hook", path: "/w/.bb-env-setup.sh", hostId: "h1", exists: true, sizeBytes: 10 },
      ],
    }),
    0,
  );
  assert.deepEqual(inv.instructions.map(i => [i.label, i.approxTokens]), [["bb user instructions", 100], ["environment setup hook", 3]]);
  assert.deepEqual(inv.missingInstructions, ["/w/CLAUDE.md"]);
  assert.equal(inv.counts.instructions, 1, "hooks are not instruction files");
});

test("the model falls back to the provider's context snapshot; context ratio is capped", () => {
  const inv = buildInventory(
    snap({ context: { usedTokens: 300, window: 200, estimated: false, model: "claude-x", autoCompactAtTokens: null, categories: [] } }),
    0,
  );
  assert.equal(inv.thread.model, "claude-x");
  assert.equal(inv.context!.ratio, 1);
  assert.equal(buildInventory(snap({ context: { usedTokens: 1, window: 0, estimated: true, model: null, autoCompactAtTokens: null, categories: [] } }), 0).context, null);
});

test("markdown: counts per group by default, every skill with --full, others only on request", () => {
  const inv = buildInventory(
    snap({
      skills: [
        skill({ name: "alpha", scope: "plugin", pluginId: "wf", description: "First line\nsecond" }),
        skill({ name: "beta", scope: "provider-user", provider: "codex", pluginId: null }),
      ],
    }),
    0,
  );
  const short = inventoryMarkdown(inv);
  assert.match(short, /- bb plugins: 1/, "bb's plugin skills share one group");
  assert.doesNotMatch(short, /alpha/);
  assert.doesNotMatch(short, /Codex user/);
  const full = inventoryMarkdown(inv, { full: true, otherProviders: true });
  assert.match(full, /  - alpha \(bb plugin wf\): First line$/m);
  assert.match(full, /- Codex user: 0 \(\+1 not reaching the agent\)/);
});
