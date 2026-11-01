import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import type { ProbeResult } from "../contract.ts";
import { activityFromItem, transcriptRole } from "../core/codex-events.ts";
import { CodexBackend, type CodexHostApi } from "../core/codex.ts";
import { candidates, pick, type Machine } from "../core/hosts.ts";
import { JsonRpcPeer } from "../core/jsonrpc.ts";
import { ConciergeThread, VOICE_PREFIX } from "../core/concierge-thread.ts";
import { agentInstructions, THREAD_BRIEF, voicePrompt } from "../core/persona.ts";
import { appendLine } from "../core/transcript.ts";

const server: Machine = { id: "h1", name: "shared-server", connected: true, isServer: true };
const mac: Machine = { id: "h2", name: "popemkt-work", connected: true, isServer: false };
const offline: Machine = { id: "h3", name: "popemkt-personal", connected: false, isServer: false };

test("candidates: the server's machine first, offline machines dropped, an explicit choice alone", () => {
  assert.deepEqual(candidates([mac, offline, server], "").map(m => m.name), ["shared-server", "popemkt-work"]);
  assert.deepEqual(candidates([mac, server], "popemkt-work").map(m => m.id), ["h2"]);
  assert.deepEqual(candidates([mac, server], "h1").map(m => m.id), ["h1"]);
  assert.deepEqual(candidates([mac, server], "nope"), []);
  // single-machine bb: the one machine is the server
  assert.deepEqual(candidates([server], "").map(m => m.id), ["h1"]);
});

test("pick: ready beats usable beats anything", () => {
  const p = (machine: Machine, result: string) => ({ machine, result });
  const ready = (r: string) => r === "ready";
  const usable = (r: string) => r !== "none";
  assert.equal(pick([p(server, "signed-out"), p(mac, "ready")], ready, usable)?.machine.id, "h2");
  assert.equal(pick([p(server, "none"), p(mac, "signed-out")], ready, usable)?.machine.id, "h2");
  assert.equal(pick([p(server, "none")], ready, usable)?.machine.id, "h1");
  assert.equal(pick([], ready, usable), null);
});

test("transcriptRole and activityFromItem", () => {
  assert.equal(transcriptRole("user"), "user");
  assert.equal(transcriptRole("input_audio"), "user");
  assert.equal(transcriptRole("assistant"), "assistant");
  assert.equal(transcriptRole(undefined), "assistant");
  assert.equal(activityFromItem({ type: "commandExecution", command: "/bin/bash -lc 'bb lanes now'" }), "'bb lanes now'");
  assert.equal(activityFromItem({ type: "commandExecution", command: "curl -H token=abc123 x" }), "curl -H token=… x");
  assert.equal(activityFromItem({ type: "agentMessage", text: "hi" }), null);
  assert.equal(activityFromItem(null), null);
});

test("appendLine merges an immediate exact repeat and stays bounded", () => {
  let lines = appendLine([], { at: 1000, role: "user", text: "where are we" });
  lines = appendLine(lines, { at: 1500, role: "user", text: "where are we" });
  assert.equal(lines.length, 1);
  lines = appendLine(lines, { at: 2000, role: "assistant", text: "two threads run" });
  assert.equal(lines.length, 2);
  let many = lines;
  for (let i = 0; i < 10; i++) many = appendLine(many, { at: 3000 + i * 20_000, role: "user", text: `q${i}` }, 5);
  assert.equal(many.length, 5);
  assert.equal(many.at(-1)?.text, "q9");
});

test("persona carries the rules to both prompts", () => {
  const ctx = { machine: "shared-server", hasBbCli: true, extra: "Call me Hoang.", relay: false };
  for (const text of [voicePrompt(ctx), agentInstructions(ctx), agentInstructions({ ...ctx, relay: true })]) {
    assert.match(text, /Never copy it, summarise it, or mention it in any other bb thread/);
    assert.match(text, /wait for a clear yes/);
    assert.match(text, /Never read secrets aloud/);
    assert.match(text, /Call me Hoang\./);
  }
  assert.match(agentInstructions(ctx), /bb lanes now/);
  assert.match(agentInstructions({ ...ctx, hasBbCli: false }), /No `bb` CLI was found/);
  // Relaying, the backing agent only asks the concierge's thread, which carries the rules itself.
  assert.match(agentInstructions({ ...ctx, relay: true }), /ask_concierge/);
  assert.doesNotMatch(agentInstructions({ ...ctx, relay: true }), /bb lanes now/);
  for (const re of [/\[voice\]/, /bb lanes now/, /wait for a clear yes/, /Never read secrets aloud/, /\(confirmed\)/]) assert.match(THREAD_BRIEF, re);
});

function fakeThreads(script: { statuses: (string | null)[]; outputs: (string | null)[] }) {
  const sent: string[] = [];
  let t = 0;
  const api = {
    status: async () => (script.statuses.length > 1 ? script.statuses.shift()! : script.statuses[0]!),
    spawn: async () => "thr_new",
    send: async (_: string, text: string) => void sent.push(text),
    output: async () => (script.outputs.length > 1 ? script.outputs.shift()! : script.outputs[0]!),
  };
  const deps = { threads: api, store: { get: async () => "thr_c", set: async () => {} }, sleep: async (ms: number) => void (t += ms), now: () => t };
  return { deps, sent };
}

test("ConciergeThread.ask waits for a running turn, sends, and returns the new turn's output", async () => {
  // current() reads idle; settle sees active then idle; after send: starting, active, idle.
  const { deps, sent } = fakeThreads({ statuses: ["idle", "active", "idle", "starting", "active", "idle"], outputs: ["Two threads are running."] });
  const reply = await new ConciergeThread(deps).ask("what is running?");
  assert.equal(reply, "Two threads are running.");
  assert.deepEqual(sent, [`${VOICE_PREFIX}what is running?`]);
});

test("ConciergeThread: no thread, archived thread, failed turn", async () => {
  const none = new ConciergeThread({ ...fakeThreads({ statuses: ["idle"], outputs: [null] }).deps, store: { get: async () => null, set: async () => {} } });
  await assert.rejects(none.ask("hi"), /no thread yet/);
  await assert.rejects(none.ensure(null, null), /No project/);
  const archived = fakeThreads({ statuses: [null], outputs: [null] });
  assert.equal(await new ConciergeThread(archived.deps).current(), null);
  assert.equal(await new ConciergeThread(archived.deps).ensure("proj_1", "host_1"), "thr_new");
  const failing = fakeThreads({ statuses: ["idle", "idle", "active", "error"], outputs: [null] });
  await assert.rejects(new ConciergeThread(failing.deps).ask("hi"), /failed/);
});

test("JsonRpcPeer: requests, notifications, server requests, failure", async () => {
  const fromServer = new PassThrough();
  const toServer = new PassThrough();
  const notes: string[] = [];
  const peer = new JsonRpcPeer(fromServer, toServer, {
    notification: m => notes.push(m),
    request: m => ({ answered: m }),
  });
  const sent: string[] = [];
  toServer.on("data", d => sent.push(String(d)));
  const pending = peer.request<{ ok: boolean }>("thread/start", { a: 1 });
  await new Promise(r => setImmediate(r));
  const req = JSON.parse(sent[0]!);
  assert.equal(req.method, "thread/start");
  fromServer.write(`${JSON.stringify({ id: req.id, result: { ok: true } })}\n{"method":"turn/started","params":{}}\n`);
  assert.deepEqual(await pending, { ok: true });
  assert.deepEqual(notes, ["turn/started"]);
  fromServer.write(`${JSON.stringify({ id: 99, method: "item/tool/call", params: {} })}\n`);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.deepEqual(JSON.parse(sent.at(-1)!), { id: 99, result: { answered: "item/tool/call" } });
  const err = peer.request("x", {});
  await new Promise(r => setImmediate(r));
  fromServer.write(`${JSON.stringify({ id: JSON.parse(sent.at(-1)!).id, error: { message: "nope" } })}\n`);
  await assert.rejects(err, /x: nope/);
  const late = peer.request("y", {});
  peer.fail(new Error("closed"));
  await assert.rejects(late, /closed/);
  await assert.rejects(peer.request("z", {}), /closed/);
});

function probe(over: Partial<ProbeResult>): ProbeResult {
  return { codexPath: "/bin/codex", codexVersion: "codex-cli 0.166.0", authType: null, account: null, bbPath: "/bin/bb", message: "signed out", ...over };
}

test("CodexBackend: picks a signed-in machine, continues the stored thread, routes live calls", async () => {
  const probes: Record<string, ProbeResult> = { h1: probe({}), h2: probe({ authType: "chatgpt", account: "me@x (plus)", message: "ready" }) };
  const calls: Array<[string, string, unknown]> = [];
  const host: CodexHostApi = {
    probe: async hostId => (calls.push(["probe", hostId, null]), probes[hostId]!),
    loginStart: async hostId => (calls.push(["loginStart", hostId, null]), { verificationUrl: "https://auth", userCode: "ABCD-1234" }),
    logout: async () => ({}),
    start: async (hostId, input) => (calls.push(["start", hostId, input]), { threadId: input.threadId ?? "thr-new", sdp: "answer-sdp" }),
    sendText: async (hostId, input) => (calls.push(["sendText", hostId, input]), {}),
    stop: async (hostId, input) => (calls.push(["stop", hostId, input]), {}),
  };
  const store = new Map<string, string>();
  const backend = new CodexBackend({
    host,
    machines: async () => [mac, server],
    settings: async () => ({ machine: "", codexHome: "dedicated", version: "v3" }),
    threads: { get: async k => store.get(k) ?? null, set: async (k, v) => void store.set(k, v) },
  });

  const s = await backend.status();
  assert.equal(s.ready, true);
  assert.equal(s.where, "popemkt-work");
  assert.equal(s.account, "me@x (plus)");

  const first = await backend.start({ offer: { kind: "webrtc", sdp: "offer" }, voice: null, extra: "", relay: false });
  assert.equal(first.conversationId, "thr-new");
  assert.equal(first.answer.sdp, "answer-sdp");
  assert.equal(store.get("h2|dedicated"), "thr-new");
  const startInput = calls.find(c => c[0] === "start")![2] as { threadId: string | null; version: string; agentInstructions: string };
  assert.equal(startInput.threadId, null);
  assert.equal(startInput.version, "v3");
  assert.match(startInput.agentInstructions, /popemkt-work/);

  await backend.sendText("thr-new", "what needs me?");
  assert.deepEqual(calls.at(-1), ["sendText", "h2", { threadId: "thr-new", text: "what needs me?" }]);
  backend.receive("thr-new", { kind: "closed", reason: "requested" });
  await assert.rejects(backend.sendText("thr-new", "again"), /not live/);

  // The next call continues the same concierge thread.
  await backend.start({ offer: { kind: "webrtc", sdp: "offer2" }, voice: "marin", extra: "", relay: false });
  const second = calls.filter(c => c[0] === "start").at(-1)![2] as { threadId: string | null; voice: string | null };
  assert.equal(second.threadId, "thr-new");
  assert.equal(second.voice, "marin");
});

test("CodexBackend: signed out everywhere offers sign-in where Codex exists, and refuses to start", async () => {
  const host: CodexHostApi = {
    probe: async hostId => (hostId === "h1" ? probe({}) : probe({ codexPath: null, message: "No Codex CLI on this machine" })),
    loginStart: async () => ({ verificationUrl: "https://auth.openai.com/codex/device", userCode: "WXYZ-9876" }),
    logout: async () => ({}),
    start: async () => assert.fail("must not start"),
    sendText: async () => ({}),
    stop: async () => ({}),
  };
  const backend = new CodexBackend({
    host,
    machines: async () => [server, mac],
    settings: async () => ({ machine: "", codexHome: "dedicated", version: "v3" }),
    threads: { get: async () => null, set: async () => {} },
  });
  const s = await backend.status();
  assert.equal(s.ready, false);
  assert.equal(s.needsLogin, true);
  assert.equal(s.where, "shared-server");
  assert.deepEqual(await backend.login(), { url: "https://auth.openai.com/codex/device", code: "WXYZ-9876" });
  await assert.rejects(backend.start({ offer: { kind: "webrtc", sdp: "o" }, voice: null, extra: "", relay: false }), /shared-server: signed out/);
});

test("relay tool: answers with the thread's reply, refuses unknown tools and empty requests", async () => {
  const { answerToolCall, ASK_TOOL } = await import("../core/relay-tool.ts");
  const asked: string[] = [];
  const ask = async (r: string) => (asked.push(r), "Nothing needs you.");
  assert.deepEqual(await answerToolCall({ tool: ASK_TOOL, arguments: { request: " what needs me? " } }, ask), { contentItems: [{ type: "inputText", text: "Nothing needs you." }], success: true });
  assert.deepEqual(asked, ["what needs me?"]);
  assert.equal((await answerToolCall({ tool: ASK_TOOL, arguments: JSON.stringify({ request: "hi" }) }, ask)).success, true);
  assert.equal((await answerToolCall({ tool: "other", arguments: {} }, ask)).success, false);
  assert.equal((await answerToolCall({ tool: ASK_TOOL, arguments: {} }, ask)).success, false);
  const empty = await answerToolCall({ tool: ASK_TOOL, arguments: { request: "x" } }, async () => "  ");
  assert.equal(empty.success, false);
  const failed = await answerToolCall({ tool: ASK_TOOL, arguments: { request: "x" } }, async () => { throw new Error("busy"); });
  assert.match(failed.contentItems[0]!.text, /could not answer: busy/);
});

test("sphere styles: every style compiles into one frame with a body and a halo", async () => {
  const { SPHERE_STYLES, STYLE_LABELS, fragmentSource } = await import("../core/sphere-styles.ts");
  for (const style of SPHERE_STYLES) {
    const src = fragmentSource(style);
    assert.match(src, /vec3 body\(Ctx c\)/);
    assert.match(src, /vec3 haloColor\(Ctx c\)/);
    assert.ok(STYLE_LABELS[style].length > 0);
  }
});

test("ConciergeThread.renew: a new thread becomes current and the previous is returned", async () => {
  let stored: string | null = "thr_old";
  const { deps } = fakeThreads({ statuses: ["idle"], outputs: [null] });
  const thread = new ConciergeThread({ ...deps, store: { get: async () => stored, set: async id => void (stored = id) } });
  assert.deepEqual(await thread.renew("proj_personal", "host_1"), { threadId: "thr_new", previous: "thr_old" });
  assert.equal(await thread.current(), "thr_new");
});
