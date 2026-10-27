// server.ts in bb's fake plugin host, with the host entry's functions answering its host calls over the synthetic
// fixtures: listing with badges, the preview, the exact spawn of an import, the import record, the Original
// session RPC, and the CLI. Run: npm test
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { createFakePluginHost, makeHostResponse, makeThreadResponse } from "@get-bb/plugin-sdk/testing";

const PLAIN = "11111111-2222-4333-8444-555555555555";
const COMPACTED = "22222222-3333-4444-8555-666666666666";
const GROWING = "33333333-4444-4555-8666-777777777777";
const root = mkdtempSync(join(tmpdir(), "session-import-server-"));
const dataDir = join(root, "plugin-data");
let hostEntry: typeof import("../host.ts");
let plugin: typeof import("../server.ts");

before(async () => {
  process.env.CLAUDE_CONFIG_DIR = root;
  for (const [dir, id, name] of [
    ["-home-user-project", PLAIN, "plain.jsonl"],
    ["-home-user-other", COMPACTED, "compacted.jsonl"],
  ] as const) {
    mkdirSync(join(root, "projects", dir), { recursive: true });
    copyFileSync(new URL(`./fixtures/${name}`, import.meta.url), join(root, "projects", dir, `${id}.jsonl`));
  }
  mkdirSync(join(root, "projects", "-home-user-growing"), { recursive: true });
  hostEntry = await import("../host.ts");
  plugin = await import("../server.ts");
});

/** The fixtures' cwd, /home/user/project, does not exist here; the session machine says so unless told otherwise. */
async function fake(opts: { cwdExists?: boolean; metadata?: Record<string, unknown>; ownedBy?: Record<string, string> } = {}) {
  const spawned: Record<string, unknown>[] = [];
  const sent: Record<string, any>[] = [];
  const updates: Record<string, any>[] = [];
  const signal = new AbortController().signal;
  const { bb, harness } = createFakePluginHost({
    pluginId: "session-import",
    experimental_callHostRpc: async ({ method, input, hostId }: { method: string; input: unknown; hostId: string }) => {
      const i = input as Record<string, never>;
      switch (method) {
        case "listSessions":
          return hostEntry.listSessions(i.sinceMs, i.limit);
        case "readTranscript":
          return hostEntry.readTranscript(i.sessionId, signal, i.since);
        case "toolOutput":
          return hostEntry.toolOutput(i.sessionId, i.toolUseId, i.maxChars, signal);
        case "inspectCwd":
          return { exists: opts.cwdExists ?? true, gitRemote: null };
        case "writeTranscript":
          return hostEntry.writeTranscript(join(dataDir, hostId), i.sessionId, i.markdown);
      }
      throw new Error(`unexpected host call ${method}`);
    },
    sdk: {
      hosts: {
        list: async () => [
          makeHostResponse({ id: "h_srv", name: "shared-server", status: "connected" }),
          makeHostResponse({ id: "h_mac", name: "popemkt-work", status: "connected" }),
        ],
      },
      system: { config: async () => ({ primaryHostId: "h_srv" }) },
      projects: {
        list: async () => [
          {
            id: "p_proj",
            name: "project",
            kind: "standard",
            gitRemoteUrl: null,
            createdAt: 1,
            updatedAt: 1,
            sources: [
              { id: "s1", projectId: "p_proj", type: "local_path", hostId: "h_mac", path: "/home/user/project", isDefault: false, createdAt: 1, updatedAt: 1 },
              { id: "s2", projectId: "p_proj", type: "local_path", hostId: "h_srv", path: "/srv/project", isDefault: true, createdAt: 1, updatedAt: 1 },
            ],
          },
        ],
      },
      threads: {
        list: async () => Object.keys(opts.ownedBy ?? {}).map(id => makeThreadResponse({ id, providerId: "claude-code" })),
        events: {
          list: async ({ threadId }: { threadId: string }) => {
            const session = opts.ownedBy?.[threadId];
            return session === undefined ? [] : [{ type: "thread/identity", providerThreadId: session, data: { providerThreadId: session } }];
          },
        },
        spawn: async (args: Record<string, unknown>) => (spawned.push(args), makeThreadResponse({ id: `thr_new${spawned.length}` })),
        getPluginMetadata: async ({ threadId }: { threadId: string }) => opts.metadata?.[threadId] ?? {},
        send: async (args: Record<string, unknown>) => (sent.push(args), { ok: true, delivery: "sent" }),
        updatePluginMetadata: async (args: Record<string, unknown>) => (updates.push(args), {}),
      },
    },
  } as unknown as Parameters<typeof createFakePluginHost>[0]);
  await plugin.default(bb);
  return { harness, spawned, sent, updates };
}

test("machines: the server first, then by name", async () => {
  const { harness } = await fake();
  const { machines } = (await harness.behavior.callRpc("machines", {})) as { machines: { name: string; isServer: boolean }[] };
  assert.deepEqual(machines.map(m => [m.name, m.isServer]), [["shared-server", true], ["popemkt-work", false]]);
});

test("sessions carry an 'in bb' badge for sessions a bb thread already owns", async () => {
  const { harness } = await fake({ ownedBy: { thr_owner: COMPACTED } });
  const out = (await harness.behavior.callRpc("sessions", { hostId: "h_mac", sinceDays: 0 })) as { sessions: { sessionId: string; ownedByThreadId: string | null }[] };
  assert.equal(out.sessions.find(s => s.sessionId === COMPACTED)?.ownedByThreadId, "thr_owner");
  assert.equal(out.sessions.find(s => s.sessionId === PLAIN)?.ownedByThreadId, null);
});

test("preview: where it would run (the session's machine and cwd) and the budget plan", async () => {
  const { harness } = await fake();
  const p = (await harness.behavior.callRpc("preview", { hostId: "h_mac", sessionId: PLAIN })) as {
    target: { projectId: string; hostId: string; path: string | null };
    environmentError: string | null;
    plan: { omitted: number; tokens: number };
    header: string;
  };
  assert.deepEqual([p.target.projectId, p.target.hostId, p.target.path], ["p_proj", "h_mac", "/home/user/project"]);
  assert.equal(p.environmentError, null);
  assert.equal(p.plan.omitted, 0);
  assert.match(p.header, /on popemkt-work/);
});

test("import: spawns in the session's cwd with the transcript agent-only, then the person's message", async () => {
  const { harness, spawned } = await fake();
  const r = (await harness.behavior.callRpc("importSession", { hostId: "h_mac", sessionId: PLAIN, firstMessage: "Carry on." })) as { threadId: string; transcriptPath: string };
  assert.equal(r.threadId, "thr_new1");
  assert.equal(r.transcriptPath, join(dataDir, "h_mac", "transcripts", `${PLAIN}.md`));
  const args = spawned[0]! as Record<string, any>;
  assert.equal(args.projectId, "p_proj");
  assert.equal(args.providerId, "claude-code");
  assert.deepEqual(args.environment, { type: "host", hostId: "h_mac", workspace: { type: "unmanaged", path: "/home/user/project" } });
  assert.equal(args.title, "↪ Fix the flaky build check");
  const [seed, file, first] = args.input;
  assert.equal(seed.visibility, "agent-only");
  assert.match(seed.text, /^This thread continues a Claude Code session that ran outside bb: session 11111111/);
  assert.match(seed.text, /# Claude Code session: Fix the flaky build check/);
  assert.deepEqual([file.type, file.hostId, file.path, file.visibility], ["localFile", "h_mac", r.transcriptPath, "agent-only"]);
  assert.deepEqual([first.type, first.text, first.visibility], ["text", "Carry on.", undefined]);
  assert.equal(args.pluginMetadata.imported.sessionId, PLAIN);
  assert.equal(args.pluginMetadata.imported.mark.lines, 19);
  assert.match(seed.text, /## Where the session stood/);
  // recorded, so the picker can say so next time
  const again = (await harness.behavior.callRpc("preview", { hostId: "h_mac", sessionId: PLAIN })) as { imports: { threadId: string }[] };
  assert.deepEqual(again.imports.map(i => i.threadId), ["thr_new1"]);
});

test("import to another machine: the project's source there, and the transcript file written there", async () => {
  const { harness, spawned } = await fake();
  const r = (await harness.behavior.callRpc("importSession", { hostId: "h_mac", sessionId: PLAIN, targetHostId: "h_srv" })) as { transcriptPath: string };
  const args = spawned[0]! as Record<string, any>;
  assert.deepEqual(args.environment, { type: "host", hostId: "h_srv", workspace: { type: "unmanaged", path: null } });
  assert.equal(args.input[1].hostId, "h_srv");
  assert.ok(r.transcriptPath.startsWith(join(dataDir, "h_srv")));
  assert.match(args.input[2].text, /^Summarise where this session stood/);
});

test("a cwd that is gone falls back to the project's source on that machine", async () => {
  const { harness, spawned } = await fake({ cwdExists: false });
  await harness.behavior.callRpc("importSession", { hostId: "h_mac", sessionId: PLAIN });
  assert.deepEqual((spawned[0] as Record<string, any>).environment, { type: "host", hostId: "h_mac", workspace: { type: "unmanaged", path: null } });
});

test("original: an imported thread reads its source session; another thread says why not", async () => {
  const metadata = {
    thr_imp: {
      imported: {
        source: "claude-code",
        sessionId: COMPACTED,
        hostId: "h_mac",
        machine: "popemkt-work",
        cwd: "/home/user/other",
        title: "Host migration",
        transcriptHostId: "h_mac",
        transcriptPath: "/x.md",
        importedAt: 1,
        sourceModified: 1,
        plan: { turns: 4, full: 4, condensed: 0, omitted: 0, cuts: [], tokens: 1, fullTokens: 1 },
      },
    },
  };
  const { harness } = await fake({ metadata });
  const o = (await harness.behavior.callRpc("original", { threadId: "thr_imp" })) as { transcript: { turns: unknown[] } | null; newTurns: number | null };
  assert.equal(o.transcript?.turns.length, 4);
  assert.equal(o.newTurns, null); // imported before sync existed: no mark
  const none = (await harness.behavior.callRpc("original", { threadId: "thr_other" })) as { reason: string };
  assert.match(none.reason, /not imported/);
  const out = (await harness.behavior.callRpc("toolOutput", { threadId: "thr_imp", toolUseId: "t1" })) as { totalChars: number };
  assert.equal(out.totalChars, 400);
});

test("CLI: machines, list, show, import", async () => {
  const { harness, spawned } = await fake();
  const machines = await harness.behavior.runCli(["machines"]);
  assert.match(machines.stdout, /shared-server\th_srv\tconnected\tserver/);
  const list = await harness.behavior.runCli(["list", "--machine", "popemkt-work", "--all"]);
  assert.equal(list.exitCode, 0, list.stderr);
  assert.match(list.stdout, /popemkt-work: 2 of 2 sessions/);
  const show = await harness.behavior.runCli(["show", PLAIN, "--machine", "popemkt-work"]);
  assert.match(show.stdout, /Would run: project on popemkt-work in \/home\/user\/project\./);
  const imp = await harness.behavior.runCli(["import", PLAIN, "--machine", "h_mac", "--prompt", "go on"]);
  assert.match(imp.stdout, /^Thread started: thr_new1/);
  assert.equal((spawned[0] as Record<string, any>).input[2].text, "go on");
  const bad = await harness.behavior.runCli(["list", "--machine", "nope"]);
  assert.equal(bad.exitCode, 2);
});

test("sync: the session's new turns go to the thread agent-only, the mark moves, a rewritten session is refused", async () => {
  const lines = readFileSync(new URL("./fixtures/brief.jsonl", import.meta.url), "utf8").trim().split("\n");
  const path = join(root, "projects", "-home-user-growing", `${GROWING}.jsonl`);
  writeFileSync(path, `${lines.slice(0, 8).join("\n")}\n`);
  const imported = await hostEntry.readTranscript(GROWING, new AbortController().signal);
  writeFileSync(path, `${lines.join("\n")}\n`);
  const record = {
    source: "claude-code",
    sessionId: GROWING,
    hostId: "h_mac",
    machine: "popemkt-work",
    cwd: "/home/user/project",
    title: null,
    transcriptHostId: "h_srv",
    transcriptPath: "/old.md",
    importedAt: 1,
    sourceModified: 1,
    plan: { turns: 1, full: 1, condensed: 0, omitted: 0, cuts: [], tokens: 1, fullTokens: 1 },
  };
  const { harness, sent, updates } = await fake({ metadata: { thr_imp: { imported: { ...record, mark: imported.source } } } });
  const o = (await harness.behavior.callRpc("original", { threadId: "thr_imp" })) as { newTurns: number | null };
  assert.equal(o.newTurns, 1);
  const r = (await harness.behavior.callRpc("sync", { threadId: "thr_imp" })) as { synced: number };
  assert.equal(r.synced, 1);
  const [agent, visible] = sent[0]!.input;
  assert.equal(sent[0]!.mode, "queue-if-active");
  assert.equal(agent.visibility, "agent-only");
  assert.match(agent.text, /went on outside bb after it was imported\. Its 1 new turn follow/);
  assert.match(agent.text, /## Where the session stood/);
  assert.match(agent.text, /The build passed\. Running the tests next\./);
  // only the new turns: the task message is in the brief, not as a turn
  assert.doesNotMatch(agent.text, /## User/);
  assert.equal(visible.visibility, undefined);
  const next = updates[0]!.set.imported;
  assert.equal(next.mark.lines, 11);
  assert.equal(next.syncs, 1);
  assert.equal(next.transcriptPath, join(dataDir, "h_srv", "transcripts", `${GROWING}.md`));
  // rewritten before the mark: refused
  writeFileSync(path, `${[lines[0]!.replace("Rename", "Remove"), ...lines.slice(1)].join("\n")}\n`);
  await assert.rejects(harness.behavior.callRpc("sync", { threadId: "thr_imp" }), /changed before the point this thread took it from/);
  // no mark: says how to get one
  const old = await fake({ metadata: { thr_old: { imported: record } } });
  await assert.rejects(old.harness.behavior.callRpc("sync", { threadId: "thr_old" }), /imported before sync existed/);
});
