// core/: reading a session into turns, the Markdown, the budget cuts, and where a thread runs. Fixtures are
// synthetic sessions shaped like real ones (tests/fixtures/*.jsonl); no real session content. Run: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { environmentFor, matchProject, normalizeRemote, resolveTarget, type ProjectInfo } from "../core/mapping.ts";
import {
  briefMarkdown,
  cleanUserText,
  notices,
  SessionReader,
  fullMarkdown,
  readSession,
  seedMarkdown,
  tokensOf,
  toolSummary,
  type ConversationTurn,
  type Transcript,
} from "../core/transcript.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const origin = { machine: "devbox" };
const plain = () => readSession("11111111-2222-4333-8444-555555555555", fixture("plain.jsonl"));
const compacted = () => readSession("22222222-3333-4444-8555-666666666666", fixture("compacted.jsonl"));
const BRIEF = "33333333-4444-4555-8666-777777777777";
const briefSession = () => readSession(BRIEF, fixture("brief.jsonl"));
const convo = (t: Transcript) => t.turns.filter((x): x is ConversationTurn => x.kind === "turn");

test("a plain session: turns, tool lines with outcomes, metadata", () => {
  const t = plain();
  assert.equal(t.title, "Fix the flaky build check");
  assert.equal(t.cwd, "/home/user/project");
  assert.equal(t.gitBranch, "main");
  assert.equal(t.model, "claude-opus-5");
  assert.equal(t.version, "2.1.300");
  const turns = convo(t);
  assert.deepEqual(
    turns.map(x => x.user?.text ?? null),
    ["Fix the flaky test in build.nix and explain why it fails.", "/review build.nix", "Looks right. Here is the log:"],
  );
  const tools = turns[0]!.blocks.flatMap(b => (b.kind === "tool" ? [b.call] : []));
  assert.deepEqual(
    tools.map(c => [c.name, c.summary, c.failed]),
    [
      ["Bash", "nix build .#checks --keep-going 2>&1 | tail", true],
      ["Edit", "/home/user/project/build.nix", false],
      ["Grep", '"flaky" in tests/', false],
    ],
  );
  assert.ok(tools[0]!.outputChars > 1000);
  assert.equal(turns[2]!.user!.images, 1);
});

test("dropped: thinking, isMeta records, reminders, sidechains, tool output, the torn last line", () => {
  const md = fullMarkdown(plain(), origin);
  assert.doesNotMatch(md, /secret reasoning/);
  assert.doesNotMatch(md, /Caveat/);
  assert.doesNotMatch(md, /internal note/);
  assert.doesNotMatch(md, /subagent prompt/);
  // tool output stays out, except the start of a failed call's error
  assert.match(md, /\(failed: error: builder failed[^\n]{0,200}\)\n/);
  assert.doesNotMatch(md, /-k flaky/);
  assert.match(md, /- Agent: general-purpose: check other tests/);
  assert.match(md, /\[1 image\]/);
});

test("the whole chain across a compaction, without the abandoned branch", () => {
  const t = compacted();
  assert.equal(t.title, "Host migration");
  assert.deepEqual(
    t.turns.map(x => (x.kind === "compaction" ? `compaction:${x.preTokens}:${x.summary?.slice(0, 8)}` : x.user?.text)),
    ["Plan the migration to the new host.", "Now write the plan down.", "compaction:150000:Summary:", "Continue with step two."],
  );
  assert.doesNotMatch(fullMarkdown(t, origin), /Abandoned/);
});

test("Markdown: a header, a section per speaker, one line per tool call", () => {
  const md = fullMarkdown(plain(), origin);
  assert.match(md, /^# Claude Code session: Fix the flaky build check\n/);
  assert.match(md, /- Session `11111111-2222-4333-8444-555555555555` on devbox/);
  assert.match(md, /- Directory `\/home\/user\/project`, branch `main`/);
  assert.match(md, /## User · 2026-10-20 10:01\n\nFix the flaky test/);
  assert.match(md, /## Claude\n\nLooking at the test first\.\n\n- Bash: nix build \.#checks --keep-going 2>&1 \| tail \(failed: error: builder failed[^\n]*\)\n- Edit: \/home\/user\/project\/build\.nix\n- Grep: "flaky" in tests\/\n\nThe test raced/);
});

test("user text: slash commands, bash mode, reminders", () => {
  assert.equal(cleanUserText("<command-name>/model</command-name><command-args></command-args>"), "/model");
  assert.equal(cleanUserText("<bash-input>ls</bash-input>"), "! ls");
  assert.equal(cleanUserText("<task-notification><task-id>x</task-id></task-notification>"), "");
  assert.equal(cleanUserText("a<system-reminder>b</system-reminder>c"), "ac");
});

test("tool summaries pick one key argument and stay short", () => {
  assert.equal(toolSummary("Read", { file_path: "/a/b.ts", offset: 3 }), "/a/b.ts");
  assert.equal(toolSummary("WebFetch", { url: "https://x.dev", prompt: "p" }), "https://x.dev");
  assert.equal(toolSummary("mcp__kb__node_get", { id: "n.1" }), "n.1");
  assert.equal(toolSummary("TodoWrite", { todos: [1, 2] }), "2 todos");
  assert.ok(toolSummary("Bash", { command: "x".repeat(500) }).length <= 120);
});

// A long session built from the fixture's shapes: many turns, each with tool calls.
function long(turns: number, toolsPerTurn = 6, compactAt: number | null = null): Transcript {
  const out: Transcript = { ...plain(), turns: [] };
  for (let i = 0; i < turns; i++) {
    if (compactAt === i) out.turns.push({ kind: "compaction", uuid: `c${i}`, at: null, summary: "Summary of everything so far.", preTokens: 1 });
    out.turns.push({
      kind: "turn",
      uuid: `t${i}`,
      at: null,
      user: { text: i === 0 ? "THE TASK" : `prompt ${i} ${"words ".repeat(40)}`, images: 0 },
      blocks: [
        { kind: "text", text: `answer ${i} ${"more words ".repeat(60)}` },
        ...Array.from({ length: toolsPerTurn }, (_, k) => ({
          kind: "tool" as const,
          call: { id: `x${i}_${k}`, name: "Read", summary: `/src/module-${i}/file-${k}.ts`, failed: false, outputChars: 1 },
        })),
      ],
    });
  }
  return out;
}

test("budget: under it, the seed is the full transcript", () => {
  const t = plain();
  const s = seedMarkdown(t, origin, 40_000);
  assert.equal(s.markdown, fullMarkdown(t, origin));
  assert.deepEqual(s.plan.cuts, []);
  assert.equal(s.plan.omitted, 0);
});

test("budget cut 1: history before the latest compaction becomes its summary; the task stays", () => {
  const t = long(60, 6, 50);
  const full = tokensOf(fullMarkdown(t, origin));
  const s = seedMarkdown(t, origin, Math.floor(full / 3));
  assert.deepEqual(s.plan.cuts, [1]);
  assert.equal(s.plan.omitted, 50);
  assert.match(s.markdown, /THE TASK/);
  assert.match(s.markdown, /50 earlier turns omitted/);
  assert.match(s.markdown, /Summary of everything so far/);
  assert.ok(s.plan.tokens <= Math.floor(full / 3));
});

test("budget cut 2: older turns lose their tool lines, the last 10 keep them", () => {
  const t = long(40, 30);
  const full = tokensOf(fullMarkdown(t, origin));
  const s = seedMarkdown(t, origin, Math.floor(full * 0.7));
  assert.deepEqual(s.plan.cuts, [2]);
  assert.equal(s.plan.condensed, 30);
  assert.equal(s.plan.full, 10);
  assert.doesNotMatch(s.markdown, /module-0\//);
  assert.match(s.markdown, /module-39\/file-0/);
  assert.match(s.markdown, /_\(30 tool calls\)_/);
});

test("budget cut 3: the oldest turns go, the task and the newest stay, and it fits", () => {
  const t = long(200, 2);
  const s = seedMarkdown(t, origin, 8_000);
  assert.deepEqual(s.plan.cuts, [2, 3]);
  assert.ok(s.plan.tokens <= 8_000, `${s.plan.tokens}`);
  assert.ok(s.plan.omitted > 100);
  assert.match(s.markdown, /THE TASK/);
  assert.match(s.markdown, /answer 199/);
  assert.equal(s.plan.full + s.plan.condensed + s.plan.omitted, 200);
});

test("budget cut 4: one turn too big for the budget is clipped", () => {
  const t = long(1, 0);
  const one = t.turns[0] as ConversationTurn;
  one.user = { text: "huge ".repeat(20_000), images: 0 };
  const s = seedMarkdown(t, origin, 2_000);
  assert.ok(s.plan.cuts.includes(4));
  assert.ok(s.plan.tokens <= 2_000);
  assert.match(s.markdown, /clipped here/);
});

// ------------------------------------------------------------------ mapping

const projects: ProjectInfo[] = [
  { id: "p_home", name: "home", gitRemoteUrl: null, sources: [{ hostId: "h_srv", path: "/home/me", isDefault: true }] },
  {
    id: "p_dot",
    name: ".dotfiles",
    gitRemoteUrl: "https://github.com/me/dotfiles.git",
    sources: [
      { hostId: "h_srv", path: "/home/me/.dotfiles", isDefault: true },
      { hostId: "h_mac", path: "/Users/me/.dotfiles", isDefault: false },
    ],
  },
  { id: "p_kb", name: "kb", gitRemoteUrl: "git@github.com:me/kb.git", sources: [{ hostId: "h_srv", path: "/home/me/Projects/kb", isDefault: true }] },
];

test("remotes compare across https, ssh and scp spellings", () => {
  assert.equal(normalizeRemote("git@github.com:me/kb.git"), "github.com/me/kb");
  assert.equal(normalizeRemote("https://github.com/Me/kb/"), "github.com/me/kb");
  assert.equal(normalizeRemote("ssh://git@github.com/me/kb.git"), "github.com/me/kb");
});

test("project: the deepest source holding the cwd; a remote match beats a bare home source", () => {
  assert.equal(matchProject(projects, { hostId: "h_srv", cwd: "/home/me/.dotfiles/modules" }, null)?.project.id, "p_dot");
  assert.equal(matchProject(projects, { hostId: "h_mac", cwd: "/Users/me/.dotfiles" }, null)?.project.id, "p_dot");
  // a kb worktree outside the kb source: found by its origin
  const wt = matchProject(projects, { hostId: "h_srv", cwd: "/home/me/.t3/worktrees/kb/feat" }, { exists: true, gitRemote: "https://github.com/me/kb" });
  assert.deepEqual([wt?.project.id, wt?.by], ["p_kb", "remote"]);
  assert.equal(matchProject(projects, { hostId: "h_mac", cwd: "/Users/me/elsewhere" }, null), null);
});

test("default target: the session's machine and its own directory", () => {
  const t = resolveTarget({ projects, session: { hostId: "h_mac", cwd: "/Users/me/.dotfiles" }, facts: { exists: true, gitRemote: null } });
  assert.deepEqual([t.projectId, t.hostId, t.path, t.notes], ["p_dot", "h_mac", "/Users/me/.dotfiles", []]);
  assert.deepEqual(environmentFor(t, projects), { type: "host", hostId: "h_mac", workspace: { type: "unmanaged", path: "/Users/me/.dotfiles" } });
});

test("another machine: the project's source there; none there is an error", () => {
  const t = resolveTarget({ projects, session: { hostId: "h_mac", cwd: "/Users/me/.dotfiles" }, facts: null, targetHostId: "h_srv" });
  assert.equal(t.path, null);
  assert.match(t.notes.join(" "), /uncommitted/);
  assert.deepEqual(environmentFor(t, projects), { type: "host", hostId: "h_srv", workspace: { type: "unmanaged", path: null } });
  const kb = resolveTarget({ projects, session: { hostId: "h_srv", cwd: "/home/me/Projects/kb" }, facts: null, targetHostId: "h_mac" });
  assert.ok("error" in environmentFor(kb, projects));
});

test("a gone or bb-managed directory falls back to the project's source; no project asks for one", () => {
  const gone = resolveTarget({ projects, session: { hostId: "h_srv", cwd: "/home/me/.dotfiles" }, facts: { exists: false, gitRemote: null } });
  assert.equal(gone.path, null);
  const bbWs = resolveTarget({
    projects,
    session: { hostId: "h_srv", cwd: "/home/me/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_x/.dotfiles" },
    facts: { exists: true, gitRemote: "https://github.com/me/dotfiles" },
  });
  assert.deepEqual([bbWs.projectId, bbWs.path], ["p_dot", null]);
  const none = resolveTarget({ projects, session: { hostId: "h_mac", cwd: "/Users/me/elsewhere" }, facts: { exists: true, gitRemote: null } });
  assert.equal(none.projectId, null);
  assert.ok("error" in environmentFor(none, projects));
  const chosen = resolveTarget({ projects, session: { hostId: "h_mac", cwd: "/Users/me/elsewhere" }, facts: { exists: true, gitRemote: null }, projectId: "p_dot" });
  assert.deepEqual(environmentFor(chosen, projects), { type: "host", hostId: "h_mac", workspace: { type: "unmanaged", path: "/Users/me/elsewhere" } });
});

// ------------------------------------------------------------------ the brief, notices, sync

test("brief: files changed and only read, the last todo list, an unfinished tool call, the last words", () => {
  const b = briefSession().brief;
  assert.deepEqual(b.filesChanged, ["/home/user/project/src/config.ts", "/home/user/project/src/main.ts"]);
  assert.deepEqual(b.filesRead, []);
  assert.deepEqual(b.todos?.map(x => x.status), ["in_progress", "pending", "pending"]);
  assert.equal(b.endedMidTool?.summary, "npm test");
  assert.equal(b.lastUser, "Rename the config loader and update its callers.");
  assert.equal(b.lastClaude, "The build passed. Running the tests next.");
  const md = briefMarkdown(briefSession());
  assert.match(md, /- Files changed \(2, most recent last\): `\/home\/user\/project\/src\/config\.ts`, `\/home\/user\/project\/src\/main\.ts`/);
  assert.match(md, /- Open todos \(3 of 3\): \[in_progress\] Rename load to loadConfig; \[pending\] Update callers/);
  assert.match(md, /ended mid-tool: `Bash: npm test` has no result/);
  assert.match(md, /### Claude's last words\n\nThe build passed/);
});

test("brief: a session whose every tool call was answered did not end mid-tool", () => {
  const b = plain().brief;
  assert.equal(b.endedMidTool, null);
  assert.ok(b.filesChanged.includes("/home/user/project/build.nix"));
});

test("a background-task notification is a line in Claude's turn, never the person's message", () => {
  assert.deepEqual(notices("<task-notification><status>completed</status><summary>Background command \"x\" completed</summary></task-notification>"), [
    'Background command "x" completed',
  ]);
  assert.deepEqual(notices("<task-notification><status>failed</status><summary>Agent \"y\" stopped</summary></task-notification>"), ['Agent "y" stopped (failed)']);
  const t = briefSession();
  const users = convo(t).map(x => x.user?.text ?? null);
  assert.ok(users.every(u => u === null || !u.includes("npm run build")));
  const md = fullMarkdown(t, origin);
  assert.match(md, /## Claude\n\n[\s\S]*_\[notification, not from the person: Background command "npm run build" completed \(exit code 0\)\]_\n\nThe build passed/);
  assert.doesNotMatch(md, /## User[^\n]*\n\n[^\n]*task-notification/);
});

test("the brief goes first and survives every cut", () => {
  const seed = seedMarkdown(briefSession(), origin, 300);
  assert.ok(seed.plan.cuts.length > 0);
  assert.match(seed.markdown, /## Where the session stood[\s\S]*## Transcript/);
  assert.match(seed.markdown, /ended mid-tool/);
});

test("sync: the turns after a record, or null when that record left the chain", () => {
  const r = new SessionReader();
  for (const line of fixture("brief.jsonl").split("\n")) if (line.trim().length > 0) r.add(JSON.parse(line));
  const all = r.finish(BRIEF);
  assert.equal(all.leafUuid, "00000000-0000-4000-8000-000000000011");
  const after = r.finish(BRIEF, "00000000-0000-4000-8000-000000000008");
  assert.equal(after?.turns.length, 1);
  const only = after!.turns[0] as ConversationTurn;
  assert.equal(only.user, null);
  assert.deepEqual(only.blocks.map(b => b.kind), ["notice", "text", "tool"]);
  assert.deepEqual(r.finish(BRIEF, all.leafUuid!)?.turns, []);
  assert.equal(r.finish(BRIEF, "not-a-record"), null);
  // the abandoned branch of the compacted fixture is not on the chain
  const c = new SessionReader();
  for (const line of fixture("compacted.jsonl").split("\n")) if (line.trim().length > 0) c.add(JSON.parse(line));
  assert.equal(c.finish("x", "00000000-0000-4000-8000-000000000005"), null);
});
