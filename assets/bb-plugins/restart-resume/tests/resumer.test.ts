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
    async events(threadId, query) {
      let rows = (init.events[threadId] ?? []).filter((row) => query.types.includes(row.type));
      if (query.afterSeq !== undefined) rows = rows.filter((row) => row.seq > query.afterSeq!);
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

const thread = (id: string, status = "error"): ThreadSummary => ({ id, status, archivedAt: null, updatedAt: NOW - 60_000 });

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
