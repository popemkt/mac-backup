// The resume loop against an in-memory bb: claims before sending, never double-sends when two
// triggers race, and sweeps only failed threads.
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { type EventRow, parseSettings, type ResumeRecord, type Settings } from "../core/policy.ts";
import { createResumer, type ResumePort, type ThreadSummary } from "../core/resumer.ts";

const NOW = 1_800_000_000_000;

function fakeBb(init: { threads: ThreadSummary[]; events: Record<string, EventRow[]>; settings?: Settings }) {
  const records = new Map<string, ResumeRecord>();
  const sent: { threadId: string; text: string }[] = [];
  const logs: string[] = [];
  let failSend = false;
  const port: ResumePort = {
    settings: async () => init.settings ?? parseSettings({}),
    recentThreads: async (since) => init.threads.filter((t) => t.updatedAt >= since),
    thread: async (id) => init.threads.find((t) => t.id === id) ?? null,
    async events(threadId, query) {
      let rows = (init.events[threadId] ?? []).filter((row) => query.types.includes(row.type));
      if (query.afterSeq !== undefined) rows = rows.filter((row) => row.seq > query.afterSeq!);
      if (query.beforeSeq !== undefined) rows = rows.filter((row) => row.seq < query.beforeSeq!);
      rows = [...rows].sort((a, b) => (query.order === "asc" ? a.seq - b.seq : b.seq - a.seq));
      // Yield, so concurrent triggers interleave as they would over the loopback API.
      await new Promise((resolve) => setImmediate(resolve));
      return rows.slice(0, query.limit);
    },
    loadRecord: async (id) => records.get(id) ?? null,
    saveRecord: async (id, record) => void records.set(id, record),
    async send(threadId, text) {
      if (failSend) throw new Error("host offline");
      sent.push({ threadId, text });
    },
    now: () => NOW,
    log: (level, message) => void logs.push(`${level}: ${message}`),
  };
  return { port, records, sent, logs, failSendNext: () => void (failSend = true) };
}

const thread = (id: string, status = "error", parentThreadId: string | null = null): ThreadSummary => ({
  id,
  status,
  archivedAt: null,
  updatedAt: NOW - 60_000,
  parentThreadId,
});

const interruptedLog = (reason: string): EventRow[] => [
  { seq: 1, type: "client/turn/requested", createdAt: NOW - 300_000, data: {} },
  { seq: 2, type: "turn/started", createdAt: NOW - 299_000, data: {} },
  { seq: 9, type: "turn/completed", createdAt: NOW - 60_000, data: { status: "interrupted" } },
  { seq: 11, type: "system/thread/interrupted", createdAt: NOW - 60_000, data: { reason } },
];

describe("the resume loop", () => {
  test("a sweep resumes restart interruptions only, once", async () => {
    const bb = fakeBb({
      threads: [thread("thr_a"), thread("thr_b"), thread("thr_c", "idle")],
      events: {
        thr_a: interruptedLog("host-daemon-restarted"),
        thr_b: interruptedLog("manual-stop"),
        thr_c: interruptedLog("host-daemon-restarted"),
      },
    });
    const resumer = createResumer(bb.port);
    await resumer.sweep();
    await resumer.sweep();
    assert.deepEqual(bb.sent.map((s) => s.threadId), ["thr_a"]);
    assert.match(bb.sent[0]!.text, /bb restarted while you were working.*\n\n\(auto-resumed after restart, 1 of 3\)$/s);
    assert.deepEqual(bb.records.get("thr_a"), { chain: 1, interruptionSeq: 11, resumedAt: NOW });
    assert.ok(bb.logs.some((line) => line.startsWith("info: thr_a: auto-resumed after restart")));
  });

  test("the failure event and a sweep racing on one thread send one message", async () => {
    const bb = fakeBb({ threads: [thread("thr_a")], events: { thr_a: interruptedLog("host-daemon-restarted") } });
    const resumer = createResumer(bb.port);
    await Promise.all([resumer.consider(thread("thr_a")), resumer.sweep(), resumer.consider(thread("thr_a"))]);
    assert.equal(bb.sent.length, 1);
  });

  test("a failed send is not retried for the same interruption", async () => {
    const bb = fakeBb({ threads: [thread("thr_a")], events: { thr_a: interruptedLog("host-daemon-restarted") } });
    bb.failSendNext();
    const resumer = createResumer(bb.port);
    await resumer.sweep();
    await resumer.sweep();
    assert.equal(bb.sent.length, 0);
    assert.equal(bb.records.get("thr_a")?.interruptionSeq, 11);
    assert.ok(bb.logs.some((line) => line.startsWith("warn: thr_a: auto-resume failed")));
  });

  test("the cap holds across interruptions until a turn completes", async () => {
    const events: EventRow[] = interruptedLog("host-daemon-restarted");
    const bb = fakeBb({ threads: [thread("thr_a")], events: { thr_a: events } });
    const resumer = createResumer(bb.port);
    const interruptAgain = (seq: number) => {
      events.push({ seq, type: "turn/started", createdAt: NOW - 50_000, data: {} });
      events.push({ seq: seq + 1, type: "turn/completed", createdAt: NOW - 40_000, data: { status: "interrupted" } });
      events.push({ seq: seq + 2, type: "system/thread/interrupted", createdAt: NOW - 40_000, data: { reason: "host-daemon-restarted" } });
    };
    await resumer.sweep();
    interruptAgain(20);
    await resumer.sweep();
    interruptAgain(30);
    await resumer.sweep();
    interruptAgain(40);
    await resumer.sweep();
    assert.equal(bb.sent.length, 3);
    assert.ok(bb.logs.some((line) => line.includes("not resumed: 3 resumes in a row")));

    // A turn that completes resets the chain; the next restart interruption is resumed again.
    events.push({ seq: 50, type: "turn/started", createdAt: NOW - 30_000, data: {} });
    events.push({ seq: 51, type: "turn/completed", createdAt: NOW - 20_000, data: { status: "completed" } });
    interruptAgain(60);
    await resumer.sweep();
    assert.equal(bb.sent.length, 4);
    assert.equal(bb.records.get("thr_a")?.chain, 1);
  });

  test("disabled sends nothing", async () => {
    const bb = fakeBb({
      threads: [thread("thr_a")],
      events: { thr_a: interruptedLog("host-daemon-restarted") },
      settings: parseSettings({ enabled: false }),
    });
    const resumer = createResumer(bb.port);
    await resumer.sweep();
    await resumer.consider(thread("thr_a"));
    assert.equal(bb.sent.length, 0);
  });
});

describe("waiting on the person", () => {
  const question = (seq: number, status: string): EventRow => ({
    seq,
    type: "system/interaction/lifecycle",
    createdAt: NOW - 100_000,
    data: { interaction: { id: `pi_${seq < 10 ? "a" : "b"}`, status, statusReason: null } },
  });

  test("a turn cut while a question was open is left for the person, and logged", async () => {
    const events = [...interruptedLog("host-daemon-restarted"), question(5, "pending"), question(12, "interrupted")];
    const bb = fakeBb({ threads: [thread("thr_a")], events: { thr_a: events } });
    await createResumer(bb.port).sweep();
    assert.equal(bb.sent.length, 0);
    assert.ok(bb.logs.includes("info: thr_a: interrupted by a restart, not resumed: was waiting on user"));
  });

  test("a question answered before the cut does not hold the resume", async () => {
    const answered: EventRow = { ...question(6, "resolved"), data: { interaction: { id: "pi_a", status: "resolved" } } };
    const events = [...interruptedLog("host-daemon-restarted"), question(5, "pending"), answered];
    const bb = fakeBb({ threads: [thread("thr_a")], events: { thr_a: events } });
    await createResumer(bb.port).sweep();
    assert.equal(bb.sent.length, 1);
  });

  test("a question from an earlier turn does not count", async () => {
    const earlier: EventRow = { seq: 1, type: "system/interaction/lifecycle", createdAt: 0, data: { interaction: { id: "pi_old", status: "interrupted" } } };
    const events = [earlier, ...interruptedLog("host-daemon-restarted").filter((row) => row.seq !== 1)];
    const bb = fakeBb({ threads: [thread("thr_a")], events: { thr_a: events } });
    await createResumer(bb.port).sweep();
    assert.equal(bb.sent.length, 1);
  });
});

describe("a parent and its child", () => {
  const restart = () => interruptedLog("host-daemon-restarted");

  test("both interrupted: only the parent is resumed, in either order", async () => {
    for (const order of [["thr_p", "thr_c"], ["thr_c", "thr_p"]]) {
      const threads = { thr_p: thread("thr_p"), thr_c: thread("thr_c", "error", "thr_p") };
      const bb = fakeBb({ threads: order.map((id) => threads[id as keyof typeof threads]), events: { thr_p: restart(), thr_c: restart() } });
      const resumer = createResumer(bb.port);
      await resumer.sweep();
      // The child's own failure event, arriving after the parent's resume.
      await resumer.consider(threads.thr_c);
      assert.deepEqual(bb.sent.map((s) => s.threadId), ["thr_p"], order.join(","));
      assert.ok(bb.logs.includes("info: thr_c: interrupted by a restart, not resumed: its parent is resumed and re-drives it"));
    }
  });

  test("a child whose parent is not resumed is resumed itself", async () => {
    const cases: Record<string, { status: string; events: EventRow[] }> = {
      "parent still running": { status: "active", events: [] },
      "parent stopped by hand": { status: "error", events: interruptedLog("manual-stop") },
    };
    for (const [name, parent] of Object.entries(cases)) {
      const bb = fakeBb({
        threads: [thread("thr_p", parent.status), thread("thr_c", "error", "thr_p")],
        events: { thr_p: parent.events, thr_c: restart() },
      });
      await createResumer(bb.port).sweep();
      assert.deepEqual(bb.sent.map((s) => s.threadId), ["thr_c"], name);
    }
  });

  test("a grandchild defers through a covered parent to the resumed root", async () => {
    const bb = fakeBb({
      threads: [thread("thr_g", "error", "thr_c"), thread("thr_c", "error", "thr_p"), thread("thr_p")],
      events: { thr_p: restart(), thr_c: restart(), thr_g: restart() },
    });
    await createResumer(bb.port).sweep();
    assert.deepEqual(bb.sent.map((s) => s.threadId), ["thr_p"]);
  });
});

describe("why a thread stopped", () => {
  test("a restart reads as resumed once the resumer claimed it, and clears when a turn completes", async () => {
    const events: Record<string, EventRow[]> = { thr_a: interruptedLog("host-daemon-restarted") };
    const bb = fakeBb({ threads: [thread("thr_a")], events });
    const resumer = createResumer(bb.port);
    assert.deepEqual((await resumer.stop("thr_a"))?.resume, { kind: "due" });
    await resumer.sweep();
    assert.deepEqual((await resumer.stop("thr_a"))?.resume, { kind: "resumed", chain: 1, max: 3, at: NOW });
    assert.equal(bb.sent.length, 1, "reading a stop never sends");
    events.thr_a!.push({ seq: 20, type: "turn/completed", createdAt: NOW, data: { status: "completed" } });
    assert.equal(await resumer.stop("thr_a"), null);
  });

  test("a manual stop is shown without asking the resume policy", async () => {
    const bb = fakeBb({ threads: [thread("thr_m", "idle")], events: { thr_m: interruptedLog("manual-stop") } });
    const stop = await createResumer(bb.port).stop("thr_m");
    assert.equal(stop?.kind, "stopped");
    assert.equal(stop?.actor, "person-or-agent");
    assert.deepEqual(stop?.resume, { kind: "none" });
  });

  test("a thread never interrupted has no stop", async () => {
    const bb = fakeBb({
      threads: [thread("thr_n", "idle")],
      events: { thr_n: [{ seq: 3, type: "turn/completed", createdAt: NOW, data: { status: "completed" } }] },
    });
    assert.equal(await createResumer(bb.port).stop("thr_n"), null);
  });
});
