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

test("sphere styles: every style has a surface and a halo shader, a label and a swatch", async () => {
  const { SPHERE_STYLES, STYLE_LABELS, STYLE_SWATCHES, meshFragmentSource, haloFragmentSource, MESH_VERTEX_SOURCE } = await import(
    "../core/sphere-styles.ts"
  );
  assert.match(MESH_VERTEX_SOURCE, /float displacement\(vec3 d\)/);
  for (const style of SPHERE_STYLES) {
    assert.match(meshFragmentSource(style), /vec3 body\(Ctx c\)/);
    assert.match(haloFragmentSource(style), /vec3 haloColor\(Ctx c\)/);
    assert.ok(STYLE_LABELS[style].length > 0 && STYLE_SWATCHES[style].length > 0);
  }
});

test("look: one setting per style and knob, values clamped into range, bad values back to the default", async () => {
  const { KNOBS, settingKey, tunesFrom, formatKnob, clampKnob } = await import("../core/look.ts");
  const { SPHERE_STYLES, meshFragmentSource, haloFragmentSource } = await import("../core/sphere-styles.ts");
  const keys = SPHERE_STYLES.flatMap(s => KNOBS.map(k => settingKey(s, k)));
  assert.equal(new Set(keys).size, SPHERE_STYLES.length * KNOBS.length);
  assert.equal(settingKey("jelly", "vividness"), "jellyVividness");
  const t = tunesFrom({ jellyVividness: 5, jellyHue: -400, jellyGlow: "x", auroraMotion: 0.5 });
  assert.deepEqual(t.jelly, { vividness: 2, motion: 1, glow: 1, hue: -180 });
  assert.equal(t.aurora.motion, 0.5);
  assert.deepEqual(t.frosted, { vividness: 1, motion: 1, glow: 1, hue: 0 });
  assert.equal(clampKnob("glow", Number.NaN), 1);
  assert.equal(formatKnob("hue", 30), "+30°");
  assert.equal(formatKnob("vividness", 1.25), "125%");
  // every knob reaches the shaders
  for (const style of SPHERE_STYLES) for (const u of ["uVivid", "uMotion", "uGlow", "uHue"]) assert.match(meshFragmentSource(style), new RegExp(u));
  assert.match(haloFragmentSource("jelly"), /uGlow/);
});

test("SettingsSaver: one write per style after the last change, nothing lost across styles, quiet only when settled", async () => {
  const { SettingsSaver } = await import("../core/look.ts");
  let clock = 0;
  const sent: [string, unknown][] = [];
  const errors: unknown[] = [];
  let fail = false;
  const saver = new SettingsSaver(
    async (style, patch) => {
      sent.push([style, patch]);
      if (fail) throw new Error("offline");
    },
    e => errors.push(e),
    20,
    () => clock,
  );
  assert.equal(saver.quiet(), true);
  saver.edit("jelly", { glow: 1.2 });
  saver.edit("jelly", { glow: 1.4, hue: 10 });
  saver.edit("aurora", { motion: 0.5 });
  assert.equal(saver.quiet(), false);
  await new Promise(r => setTimeout(r, 40));
  assert.deepEqual(sent, [["jelly", { glow: 1.4, hue: 10 }], ["aurora", { motion: 0.5 }]]);
  assert.equal(saver.quiet(), false); // an echo of an older write may still be on its way
  clock = 1000;
  assert.equal(saver.quiet(), true);
  fail = true;
  saver.edit("frosted", { vividness: 0 });
  saver.flush(); // the page going away writes at once
  await new Promise(r => setTimeout(r, 5));
  assert.equal(sent.length, 3);
  assert.equal(errors.length, 1);
});

test("SettingsSaver: writes for one style never overtake each other; the settled state comes from the last answer", async () => {
  const { SettingsSaver } = await import("../core/look.ts");
  const order: string[] = [];
  const gates: (() => void)[] = [];
  const saver = new SettingsSaver<string>(
    (_style, patch) =>
      new Promise<string>(resolve => {
        const v = String(patch.glow);
        order.push(`start ${v}`);
        gates.push(() => (order.push(`end ${v}`), resolve(v)));
      }),
    () => {},
    1,
  );
  let settled: string | null = null;
  saver.onSettled = r => (settled = r);
  saver.edit("jelly", { glow: 1 });
  saver.flush();
  saver.edit("jelly", { glow: 2 });
  saver.flush();
  await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(order, ["start 1"]); // the second write waits for the first
  gates[0]!();
  await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(order, ["start 1", "end 1", "start 2"]);
  assert.equal(settled, null); // not settled while a write is still out
  gates[1]!();
  await new Promise(r => setTimeout(r, 5));
  assert.equal(settled, "2");
});

test("icosphere: 10242 unit vertices and 20480 triangles at detail 5, all indices in range", async () => {
  const { icosphere } = await import("../sphere.ts");
  const { positions, indices } = icosphere(5);
  assert.equal(positions.length / 3, 10242);
  assert.equal(indices.length / 3, 20480);
  for (let i = 0; i < positions.length; i += 3) assert.ok(Math.abs(Math.hypot(positions[i]!, positions[i + 1]!, positions[i + 2]!) - 1) < 1e-6);
  assert.ok(Math.max(...indices) < 10242);
});

test("ConciergeThread.renew: a new thread becomes current and the previous is returned", async () => {
  let stored: string | null = "thr_old";
  const { deps } = fakeThreads({ statuses: ["idle"], outputs: [null] });
  const thread = new ConciergeThread({ ...deps, store: { get: async () => stored, set: async id => void (stored = id) } });
  assert.deepEqual(await thread.renew("proj_personal", "host_1"), { threadId: "thr_new", previous: "thr_old" });
  assert.equal(await thread.current(), "thr_new");
});

test("orb: docks during a call once there is content or after a few seconds; hover, the toggle and hanging up open it", async () => {
  const { orbMinimized } = await import("../core/orb.ts");
  const { isFresh } = await import("../core/concierge-thread.ts");
  const base = { auto: true, phase: "live" as const, hasContent: false, settled: false, brief: false, override: null, hovered: false };
  assert.equal(orbMinimized(base), false);
  assert.equal(orbMinimized({ ...base, settled: true, brief: true }), true);
  assert.equal(orbMinimized({ ...base, hasContent: true }), false);
  assert.equal(orbMinimized({ ...base, hasContent: true, brief: true }), true);
  assert.equal(orbMinimized({ ...base, brief: true }), false);
  assert.equal(orbMinimized({ ...base, phase: "connecting", hasContent: true }), false);
  assert.equal(orbMinimized({ ...base, phase: "idle", hasContent: true, settled: true }), false);
  assert.equal(orbMinimized({ ...base, settled: true, hovered: true }), false);
  assert.equal(orbMinimized({ ...base, settled: true, override: false }), false);
  assert.equal(orbMinimized({ ...base, phase: "idle", override: true }), true);
  assert.equal(orbMinimized({ ...base, auto: false, settled: true, hasContent: true }), false);
  assert.equal(isFresh(null), true);
  assert.equal(isFresh(" Ready. "), true);
  assert.equal(isFresh("You have three threads running."), false);
});

test("copy: state labels, the idle hint, and errors said plainly", async () => {
  const { stateLabel, idleHint, friendlyError } = await import("../core/copy.ts");
  const base = { look: "listening" as const, phase: "live" as const, muted: false, ready: true, checking: false };
  assert.equal(stateLabel(base), "Listening");
  assert.equal(stateLabel({ ...base, muted: true }), "Muted");
  assert.equal(stateLabel({ ...base, look: "thinking" }), "Looking that up…");
  assert.equal(stateLabel({ ...base, phase: "idle", look: "idle", ready: false, needsLogin: true }), "Sign in to talk");
  assert.equal(stateLabel({ ...base, look: "speaking" }), "Speaking");
  assert.equal(stateLabel({ ...base, phase: "connecting", look: "connecting" }), "Connecting…");
  assert.equal(stateLabel({ ...base, phase: "idle", look: "idle" }), "Ready when you are");
  assert.equal(stateLabel({ ...base, phase: "idle", look: "idle", ready: false, checking: true }), "Getting ready…");
  assert.match(idleHint(false, true), /⌘⇧M/);
  assert.equal(idleHint(true, false), "Tap Talk to start");
  assert.match(friendlyError("NotAllowedError: Permission denied").text, /microphone is blocked/);
  assert.match(friendlyError("The voice connection failed").text, /connection dropped/);
  assert.deepEqual(friendlyError("something odd"), { text: "Something went wrong with the call. Try again.", details: "something odd" });
});

import { VISUAL_STYLES, controlsFor } from "../core/visuals.ts";
import { defaultsFor, knobsFor } from "../core/look.ts";

test("every visual exposes bounded defaults and only its own controls", () => {
  for (const style of VISUAL_STYLES) {
    const defaults = defaultsFor(style);
    for (const [key, range] of Object.entries(controlsFor(style))) {
      assert.ok(defaults[key]! >= range.min && defaults[key]! <= range.max, `${style}.${key}`);
    }
    assert.deepEqual(Object.keys(defaults), knobsFor(style));
  }
  assert.ok(knobsFor("chromeOrbit").includes("rings"));
  assert.ok(!knobsFor("jelly").includes("rings"));
});

test("orbit bands: closed manifold, finite vertices, outward winding and Uint16-safe indices", async () => {
  const { orbitBands } = await import("../core/chrome-orbit.ts");
  const { positions, indices } = orbitBands();
  assert.equal(positions.length / 3, 9 * 128 * 16);
  assert.equal(indices.length, 9 * 128 * 16 * 6);
  assert.ok(Array.from(positions).every(Number.isFinite));
  const edges = new Map<string, number>();
  const point = (index: number) => {
    const a = positions[index * 3]!, b = positions[index * 3 + 1]!;
    return [(1 + 0.1 * Math.cos(b)) * Math.cos(a), (1 + 0.1 * Math.cos(b)) * Math.sin(a), 0.05 * Math.sin(b)];
  };
  for (let i = 0; i < indices.length; i += 3) {
    const ids = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
    assert.ok(ids.every(id => id < positions.length / 3));
    assert.equal(new Set(ids.map(id => positions[id * 3 + 2])).size, 1);
    const [a, b, c] = ids.map(point);
    const u = b!.map((v, j) => v - a![j]!);
    const v = c!.map((value, j) => value - a![j]!);
    const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const major = positions[ids[0]! * 3]!, section = positions[ids[0]! * 3 + 1]!;
    const normal = [Math.cos(major) * Math.cos(section) / 0.1, Math.sin(major) * Math.cos(section) / 0.1, Math.sin(section) / 0.05];
    assert.ok(cross.reduce((sum, value, j) => sum + value * normal[j]!, 0) > 0);
    for (let j = 0; j < 3; j++) {
      const from = ids[j]!, to = ids[(j + 1) % 3]!;
      const key = `${Math.min(from, to)}:${Math.max(from, to)}`;
      edges.set(key, (edges.get(key) ?? 0) + (from < to ? 1 : -1));
    }
  }
  assert.ok(Array.from(edges.values()).every(balance => balance === 0));
});

import { VisualInteraction } from "../core/visual-interaction.ts";

test("visual interaction: chrome intro, timed alignment and indefinite alignment", () => {
  const visual = new VisualInteraction("chromeOrbit", 0);
  assert.equal(visual.tick(0, 0).align, 1);
  for (let i = 0; i < 30; i++) visual.tick(0.1, 900 + i * 100);
  assert.ok(visual.tick(0.1, 4000).align < 0.001);
  assert.equal(visual.activate(4000, 1), true);
  for (let i = 0; i < 9; i++) visual.tick(0.1, 4000 + i * 100);
  assert.ok(visual.tick(0.1, 4900).align > 0.99);
  for (let i = 0; i < 30; i++) visual.tick(0.1, 5000 + i * 100);
  assert.ok(visual.tick(0.1, 8000).align < 0.001);
  visual.activate(8000, 0);
  for (let i = 0; i < 30; i++) visual.tick(0.1, 100000 + i * 100);
  assert.ok(visual.tick(0.1, 104000).align > 0.999);
  visual.activate(104000);
  for (let i = 0; i < 30; i++) visual.tick(0.1, 104000 + i * 100);
  assert.ok(visual.tick(0.1, 108000).align < 0.001);
});

test("visual interaction: call gestures are unconsumed, pointer bounded and invalid values neutral", () => {
  const visual = new VisualInteraction("jelly", 0);
  assert.equal(visual.activate(0), false);
  visual.point(20, -20);
  for (let i = 0; i < 20; i++) visual.tick(0.1, i * 100);
  const p = visual.tick(0.1, 2100);
  assert.ok(p.x > 0.99 && p.x <= 1.12);
  assert.ok(p.y < -0.99 && p.y >= -1.12);
  visual.point(NaN, Infinity);
  for (let i = 0; i < 30; i++) visual.tick(0.1, 2200 + i * 100);
  const neutral = visual.tick(0.1, 5300);
  assert.ok(Math.abs(neutral.x) < 0.001 && Math.abs(neutral.y) < 0.001);
});

test("visual interaction: reduced motion suppresses pointer and tap, reset clears previous visual state", () => {
  const visual = new VisualInteraction("chromeOrbit", 0, true);
  assert.equal(visual.tick(0, 0, true).align, 0);
  visual.reset("aiBlob", 0);
  visual.point(1, 1);
  assert.equal(visual.activate(0), true);
  assert.ok(visual.tick(0.01, 10).tap > 0);
  const still = visual.tick(0.1, 100, true);
  assert.deepEqual([still.x, still.y, still.tap], [0, 0, 0]);
  visual.reset("gradientBlob", 200);
  const reset = visual.tick(0, 200);
  for (const key of ["x", "y", "vx", "vy", "tap", "press", "intro"] as const) assert.equal(reset[key], 0);
  assert.equal(visual.activate(200), true);
});

test("SettingsSaver: string settings coalesce and serialize while local preview owns echoes", async () => {
  const { SettingsSaver } = await import("../core/look.ts");
  let now = 0;
  const written: string[] = [];
  let release: (() => void) | undefined;
  const saver = new SettingsSaver<void, string, { value: string }>(async (_key, patch) => {
    written.push(patch.value);
    if (written.length === 1) await new Promise<void>(resolve => { release = resolve; });
  }, e => { throw e; }, 10000, () => now);
  saver.edit("style", { value: "jelly" });
  saver.edit("style", { value: "chromeOrbit" });
  saver.flush();
  await new Promise(resolve => setImmediate(resolve));
  saver.edit("style", { value: "aiBlob" });
  saver.flush();
  assert.deepEqual(written, ["chromeOrbit"]);
  assert.equal(saver.quiet(), false);
  release!();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(written, ["chromeOrbit", "aiBlob"]);
  assert.equal(saver.quiet(), false);
  now = 801;
  assert.equal(saver.quiet(), true);
});
