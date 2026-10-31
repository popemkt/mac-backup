// host.ts against a temporary Claude config dir holding the synthetic fixtures: listing, streaming a transcript,
// one tool output, the cwd probe, the transcript file, and that no session file is touched. Run: npm test
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import type { Transcript } from "../core/transcript.ts";

const root = mkdtempSync(join(tmpdir(), "session-import-"));
const projects = join(root, "projects");
const PLAIN = "11111111-2222-4333-8444-555555555555";
const GROWING = "33333333-4444-4555-8666-777777777777";
const COMPACTED = "22222222-3333-4444-8555-666666666666";
const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);
const files: string[] = [];
let host: typeof import("../host.ts");

before(async () => {
  process.env.CLAUDE_CONFIG_DIR = root;
  for (const [dir, id, name] of [
    ["-home-user-project", PLAIN, "plain.jsonl"],
    ["-home-user-other", COMPACTED, "compacted.jsonl"],
  ] as const) {
    mkdirSync(join(projects, dir), { recursive: true });
    const path = join(projects, dir, `${id}.jsonl`);
    copyFileSync(fixture(name), path);
    files.push(path);
  }
  host = await import("../host.ts");
});

const digest = () => files.map(f => `${createHash("sha256").update(readFileSync(f)).digest("hex")}:${statSync(f).mtimeMs}`);

test("finds every session file under CLAUDE_CONFIG_DIR/projects", () => {
  assert.equal(host.projectsRoot(), projects);
  assert.deepEqual([...host.sessionFiles().keys()].sort(), [PLAIN, COMPACTED]);
  assert.equal(host.sessionFiles().has(GROWING), false);
});

test("lists sessions through the Agent SDK, newest first, with titles and cwd", async () => {
  const before = digest();
  const { sessions, total } = await host.listSessions(0, 50);
  assert.equal(total, 2);
  const plain = sessions.find(s => s.sessionId === PLAIN)!;
  assert.equal(plain.cwd, "/home/user/project");
  assert.ok(plain.title !== null);
  assert.ok(plain.fileSize > 0);
  const recent = await host.listSessions(Date.now() + 60_000, 50);
  assert.equal(recent.total, 0);
  assert.deepEqual(digest(), before);
});

test("streams a transcript and reports what it cost", async () => {
  const before = digest();
  const { transcript, stats } = await host.readTranscript(COMPACTED, new AbortController().signal);
  assert.equal(transcript.turns.length, 4);
  assert.equal(stats.clipped, false);
  assert.ok(stats.records > 0 && stats.bytes > 0);
  await assert.rejects(host.readTranscript("33333333-3333-4333-8333-333333333333", new AbortController().signal), /No Claude Code session/);
  assert.deepEqual(digest(), before);
});

test("reads one tool call's output again, capped", async () => {
  const out = await host.toolOutput(PLAIN, "toolu_1", 30, new AbortController().signal);
  assert.equal(out.failed, true);
  assert.ok(out.totalChars > 1000);
  assert.match(out.text!, /^error: builder failed/);
  assert.match(out.text!, /more characters\]$/);
  const missing = await host.toolOutput(PLAIN, "toolu_nope", 30, new AbortController().signal);
  assert.equal(missing.text, null);
});

test("inspects a cwd: gone, or there with its git origin", async () => {
  assert.deepEqual(await host.inspectCwd(join(root, "nope")), { exists: false, gitRemote: null });
  assert.deepEqual(await host.inspectCwd(root), { exists: true, gitRemote: null });
});

test("writes the transcript only in the plugin's data dir", async () => {
  const dataDir = join(root, "plugin-data");
  const { path, sizeBytes } = await host.writeTranscript(dataDir, PLAIN, "# hi\n");
  assert.equal(path, join(dataDir, "transcripts", `${PLAIN}.md`));
  assert.equal(readFileSync(path, "utf8"), "# hi\n");
  assert.equal(sizeBytes, 5);
});

test("a transcript too big for one RPC answer is clipped, not dropped", () => {
  const big: Transcript = {
    sessionId: PLAIN,
    title: null,
    cwd: null,
    gitBranch: null,
    model: null,
    version: null,
    startedAt: null,
    endedAt: null,
    leafUuid: null,
    brief: { filesChanged: [], filesRead: [], todos: null, endedMidTool: null, lastUser: null, lastClaude: null },
    turns: Array.from({ length: 50 }, (_, i) => ({ kind: "turn" as const, uuid: `t${i}`, at: null, user: { text: "x".repeat(100_000), images: 0 }, blocks: [] })),
  };
  const fit = host.fitForTransport(big, 1_000_000);
  assert.equal(fit.clipped, true);
  assert.equal(fit.transcript.turns.length, 50);
  assert.ok(JSON.stringify(fit.transcript).length <= 1_000_000);
  writeFileSync(join(root, "ok"), "");
});

test("a mark taken at import finds the turns appended since, and refuses a rewritten file", async () => {
  const lines = readFileSync(fixture("brief.jsonl"), "utf8").trim().split("\n");
  const dir = join(projects, "-home-user-growing");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${GROWING}.jsonl`);
  // imported while Claude Code was mid-write: eight records and a torn ninth
  writeFileSync(path, `${lines.slice(0, 8).join("\n")}\n${lines[8]!.slice(0, 40)}`);
  const signal = new AbortController().signal;
  const first = await host.readTranscript(GROWING, signal);
  assert.equal(first.source.lines, 8);
  assert.equal(first.source.leafUuid, "00000000-0000-4000-8000-000000000008");
  assert.equal(first.newTurns, null);
  // the torn line completes and the session goes on
  writeFileSync(path, `${lines.join("\n")}\n`);
  const later = await host.readTranscript(GROWING, signal, first.source);
  assert.equal(later.newTurns?.length, 1);
  assert.equal(later.source.lines, 11);
  const none = await host.readTranscript(GROWING, signal, later.source);
  assert.deepEqual(none.newTurns, []);
  // an earlier record changed: not the session the thread took
  writeFileSync(path, `${[lines[0]!.replace("Rename", "Remove"), ...lines.slice(1)].join("\n")}\n`);
  assert.equal((await host.readTranscript(GROWING, signal, first.source)).newTurns, null);
});
