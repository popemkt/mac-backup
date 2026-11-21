// Automatic report-up against an in-memory port with a hand-driven clock: debounce, the guards,
// and that two agents answering each other cannot loop.
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { buildMeta, type RoleMeta } from "../core/model.ts";
import { createReporter, formatReport, REPORT_MAX_CHARS, type ReportRecord, type ReportSettings } from "../core/reporter.ts";

const NOW = 1_800_000_000_000;

function setup(init: { metas: Record<string, RoleMeta | null>; settings?: Partial<ReportSettings> }) {
  const sent: { to: string; from: string; text: string }[] = [];
  const records = new Map<string, ReportRecord>();
  const timers = new Map<number, { run: () => void; at: number }>();
  const logs: string[] = [];
  let clock = NOW;
  let nextTimer = 1;
  let failSend = false;
  const settings: ReportSettings = { enabled: true, debounceMs: 20_000, maxPerHour: 3, architects: true, projectChiefs: true, ...init.settings };
  const reporter = createReporter({
    settings: async () => settings,
    meta: async (id) => init.metas[id] ?? null,
    title: async (id) => `Title of ${id}`,
    reportsToOf: (id) => init.metas[id]?.reportsTo ?? null,
    async send(to, from, text) {
      if (failSend) throw new Error("offline");
      sent.push({ to, from, text });
    },
    loadRecord: async (id) => structuredClone(records.get(id) ?? null),
    saveRecord: async (id, record) => void records.set(id, structuredClone(record)),
    now: () => clock,
    setTimer(run, ms) {
      const id = nextTimer++;
      timers.set(id, { run, at: clock + ms });
      return id;
    },
    clearTimer: (handle) => void timers.delete(handle as number),
    log: (level, message) => void logs.push(`${level}: ${message}`),
  });
  /** Advance the clock and run due timers, then let their async work settle. */
  async function advance(ms: number) {
    clock += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= clock) {
        timers.delete(id);
        timer.run();
      }
    }
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  }
  return { reporter, sent, records, timers, logs, advance, settings, failNext: () => void (failSend = true) };
}

const architect = buildMeta("thr_arch01", { role: "architect", projectId: "proj_dotfil", taskKey: "DOT-12", reportsTo: "thr_chief1" }, NOW);
const chief = buildMeta("thr_chief1", { role: "project-chief", projectId: "proj_dotfil", reportsTo: "thr_coord1" }, NOW);
const coordinator = buildMeta("thr_coord1", { role: "coordinator" }, NOW);
const metas = { thr_arch01: architect, thr_chief1: chief, thr_coord1: coordinator };

describe("report-up", () => {
  test("reports the final text once the thread stays idle for the window", async () => {
    const t = setup({ metas });
    await t.reporter.onIdle("thr_arch01", "Done: PR #1");
    await t.advance(19_000);
    assert.equal(t.sent.length, 0);
    await t.advance(1_000);
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0]!.to, "thr_chief1");
    assert.equal(t.sent[0]!.from, "thr_arch01");
    assert.match(t.sent[0]!.text, /^\[chief-mode report\] Task architect "Title of thr_arch01" \(thr_arch01\) for DOT-12 finished a turn:\n\nDone: PR #1$/u);
  });

  test("a turn that starts within the window cancels; the next idle reports its own text", async () => {
    const t = setup({ metas });
    await t.reporter.onIdle("thr_arch01", "first");
    await t.advance(5_000);
    t.reporter.onActive("thr_arch01");
    await t.advance(30_000);
    assert.equal(t.sent.length, 0);
    await t.reporter.onIdle("thr_arch01", "second");
    await t.advance(20_000);
    assert.deepEqual(
      t.sent.map((s) => s.text.split("\n\n")[1]),
      ["second"],
    );
  });

  test("the coordinator, unroled threads and empty text never report", async () => {
    const t = setup({ metas });
    assert.equal(await t.reporter.flushNow("thr_coord1", "hi"), "no-role");
    assert.equal(await t.reporter.flushNow("thr_unknown", "hi"), "no-role");
    assert.equal(await t.reporter.flushNow("thr_arch01", "   "), "empty");
    await t.reporter.onIdle("thr_arch01", null);
    assert.equal(t.timers.size, 0);
  });

  test("settings and the thread's own autoReport turn it off", async () => {
    assert.equal(await setup({ metas, settings: { architects: false } }).reporter.flushNow("thr_arch01", "x"), "disabled");
    assert.equal(await setup({ metas, settings: { projectChiefs: false } }).reporter.flushNow("thr_chief1", "x"), "disabled");
    assert.equal(await setup({ metas, settings: { enabled: false } }).reporter.flushNow("thr_arch01", "x"), "disabled");
    const quiet = { ...architect, autoReport: false };
    assert.equal(await setup({ metas: { ...metas, thr_arch01: quiet } }).reporter.flushNow("thr_arch01", "x"), "disabled");
    const orphan = { ...architect, reportsTo: null };
    assert.equal(await setup({ metas: { thr_arch01: orphan } }).reporter.flushNow("thr_arch01", "x"), "no-target");
  });

  test("the same text is not sent twice in a row", async () => {
    const t = setup({ metas });
    assert.equal(await t.reporter.flushNow("thr_arch01", "Blocked on X"), "sent");
    assert.equal(await t.reporter.flushNow("thr_arch01", "Blocked on X  "), "duplicate");
    assert.equal(await t.reporter.flushNow("thr_arch01", "Unblocked"), "sent");
  });

  test("a rate cap per hour stops a runaway exchange, and resets after the hour", async () => {
    const t = setup({ metas, settings: { maxPerHour: 2 } });
    assert.equal(await t.reporter.flushNow("thr_chief1", "a"), "sent");
    assert.equal(await t.reporter.flushNow("thr_chief1", "b"), "sent");
    assert.equal(await t.reporter.flushNow("thr_chief1", "c"), "rate-limited");
    await t.advance(3_600_001);
    assert.equal(await t.reporter.flushNow("thr_chief1", "d"), "sent");
    assert.ok(t.logs.some((line) => line.includes("reports in the last hour")));
  });

  test("a reportsTo loop is refused", async () => {
    const a = buildMeta("thr_loopa", { role: "project-chief", projectId: "proj_dotfil", reportsTo: "thr_loopb" }, NOW);
    const b = buildMeta("thr_loopb", { role: "project-chief", projectId: "proj_dotfil", reportsTo: "thr_loopa" }, NOW);
    const t = setup({ metas: { thr_loopa: a, thr_loopb: b } });
    assert.equal(await t.reporter.flushNow("thr_loopa", "x"), "cycle");
    assert.equal(t.sent.length, 0);
    const manual = await t.reporter.manual("thr_loopa", "x");
    assert.equal(manual.ok, false);
  });

  test("a manual report makes that turn's automatic report stand down", async () => {
    const t = setup({ metas });
    const result = await t.reporter.manual("thr_arch01", "Halfway: tests pass");
    assert.deepEqual(result, { ok: true, to: "thr_chief1" });
    assert.match(t.sent[0]!.text, /reports:\n\nHalfway/u);
    await t.reporter.onIdle("thr_arch01", "Final words");
    await t.advance(20_000);
    assert.equal(t.sent.length, 1);
    // The turn after reports normally again.
    await t.reporter.onIdle("thr_arch01", "Next turn");
    await t.advance(20_000);
    assert.equal(t.sent.length, 2);
  });

  test("a failed send is logged and not recorded, so the next idle retries", async () => {
    const t = setup({ metas });
    t.failNext();
    assert.equal(await t.reporter.flushNow("thr_arch01", "x"), "failed");
    assert.equal(t.records.get("thr_arch01"), undefined);
  });

  test("dispose clears pending timers", async () => {
    const t = setup({ metas });
    await t.reporter.onIdle("thr_arch01", "x");
    assert.equal(t.reporter.pendingCount(), 1);
    t.reporter.dispose();
    assert.equal(t.timers.size, 0);
  });

  test("long reports are truncated", () => {
    const text = formatReport(architect, "thr_arch01", "T", "x".repeat(REPORT_MAX_CHARS + 50), false);
    assert.ok(text.length < REPORT_MAX_CHARS + 300);
    assert.match(text, /truncated/u);
  });
});
