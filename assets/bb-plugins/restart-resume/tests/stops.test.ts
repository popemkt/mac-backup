// Why a thread stopped: which interruption stands, how it is classified and shown, and how the
// sidebar rows are brought up to date.
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import type { EventRow } from "../core/policy.ts";
import {
  ago,
  batches,
  type Interruption,
  kindOf,
  present,
  resumeStateOf,
  type RowStatus,
  rowStatusChanges,
  standingInterruption,
  stopView,
} from "../core/stops.ts";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const interrupted = (seq: number, reason: string, cause?: string): EventRow => ({
  seq,
  type: "system/thread/interrupted",
  createdAt: NOW - 5 * MIN,
  data: cause === undefined ? { reason } : { reason, cause },
});
const completed = (seq: number, status: string): EventRow => ({
  seq,
  type: "turn/completed",
  createdAt: NOW - MIN,
  data: { status },
});

const interruption = (over: Partial<Interruption> = {}): Interruption => ({
  seq: 10,
  at: NOW - 5 * MIN,
  reason: "host-daemon-restarted",
  cause: null,
  ...over,
});

describe("the standing interruption", () => {
  test("a restart: bb writes the interrupted turn's completion first", () => {
    assert.deepEqual(standingInterruption([completed(9, "interrupted"), interrupted(10, "host-daemon-restarted")]), {
      seq: 10,
      at: NOW - 5 * MIN,
      reason: "host-daemon-restarted",
      cause: null,
    });
  });

  test("a manual stop: the turn's interrupted completion comes after, and does not clear it", () => {
    const stop = standingInterruption([completed(12, "interrupted"), interrupted(11, "manual-stop")]);
    assert.equal(stop?.reason, "manual-stop");
  });

  test("a later completed turn clears it, a later failed one too", () => {
    assert.equal(standingInterruption([interrupted(10, "manual-stop"), completed(14, "completed")]), null);
    assert.equal(standingInterruption([interrupted(10, "manual-stop"), completed(14, "failed")]), null);
  });

  test("the newest interruption wins; none means no stop", () => {
    const rows = [interrupted(3, "manual-stop"), completed(5, "completed"), interrupted(8, "host-daemon-restarted", "host-connection-lost")];
    assert.deepEqual(standingInterruption(rows), interruption({ seq: 8, cause: "host-connection-lost" }));
    assert.equal(standingInterruption([completed(2, "completed")]), null);
    assert.equal(standingInterruption([]), null);
  });

  test("a malformed interruption still stands, as unknown", () => {
    assert.equal(standingInterruption([{ seq: 1, type: "system/thread/interrupted", createdAt: NOW, data: null }])?.reason, "unknown");
  });
});

describe("classification", () => {
  test("every reason bb 0.46.1 declares, and the connection-lost cause", () => {
    assert.equal(kindOf(interruption({ reason: "manual-stop" })), "stopped");
    assert.equal(kindOf(interruption()), "daemon-restarted");
    assert.equal(kindOf(interruption({ cause: "host-connection-lost" })), "connection-lost");
    assert.equal(kindOf(interruption({ reason: "host-removed" })), "host-removed");
    assert.equal(kindOf(interruption({ reason: "provider-turn-idle" })), "turn-idle");
    assert.equal(kindOf(interruption({ reason: "something-new" })), "unknown");
  });

  test("a manual stop is a person or an agent, never told apart; the rest are bb", () => {
    assert.equal(stopView("t", interruption({ reason: "manual-stop" }), { kind: "none" }).actor, "person-or-agent");
    assert.equal(stopView("t", interruption(), { kind: "none" }).actor, "bb");
  });
});

describe("the resume state", () => {
  const record = { chain: 2, interruptionSeq: 10, resumedAt: NOW - 4 * MIN };

  test("the record claims this interruption: resumed n of max", () => {
    assert.deepEqual(resumeStateOf(interruption(), record, null, 3), { kind: "resumed", chain: 2, max: 3, at: NOW - 4 * MIN });
  });

  test("a record of an older interruption does not count", () => {
    assert.deepEqual(resumeStateOf(interruption({ seq: 20 }), record, null, 3), { kind: "none" });
  });

  test("the policy holds it back, or is about to resume it", () => {
    assert.deepEqual(resumeStateOf(interruption(), null, { action: "skip", reason: "waiting-on-user" }, 3), {
      kind: "held",
      why: "waiting-on-user",
    });
    assert.deepEqual(resumeStateOf(interruption(), null, { action: "skip", reason: "cap-reached" }, 3), {
      kind: "held",
      why: "cap-reached",
    });
    assert.deepEqual(
      resumeStateOf(interruption(), null, { action: "resume", record: { chain: 1, interruptionSeq: 10, resumedAt: NOW } }, 3),
      { kind: "due" },
    );
    assert.deepEqual(resumeStateOf(interruption(), null, { action: "skip", reason: "not-failed" }, 3), { kind: "none" });
  });

  test("never for a stop that is not a restart", () => {
    assert.deepEqual(resumeStateOf(interruption({ reason: "manual-stop" }), record, null, 3), { kind: "none" });
  });
});

describe("presentation", () => {
  test("a manual stop", () => {
    const shown = present(stopView("t", interruption({ reason: "manual-stop" }), { kind: "none" }), "idle", NOW);
    assert.equal(shown.short, "Stopped");
    assert.equal(shown.tone, "default");
    assert.equal(shown.icon, "Square");
    assert.deepEqual(shown.details, [
      "Stopped",
      "Reason: manual-stop",
      "By: you or an agent (bb does not record which)",
      "When: 5 min ago",
      "Clears when a later turn completes.",
    ]);
  });

  test("a restart resumed 1 of 3, running again", () => {
    const view = stopView("t", interruption(), { kind: "resumed", chain: 1, max: 3, at: NOW - 4 * MIN });
    const shown = present(view, "active", NOW);
    assert.equal(shown.short, "Daemon restart → resumed 1/3");
    assert.equal(shown.label, "Last turn interrupted: Daemon restart → resumed 1/3");
    assert.equal(shown.tone, "running");
    assert.ok(shown.details.includes("Auto-resume: resumed 1 of 3, 4 min ago"));
  });

  test("a lost connection held back because it waited on the person", () => {
    const view = stopView("t", interruption({ cause: "host-connection-lost" }), { kind: "held", why: "waiting-on-user" });
    const shown = present(view, "error", NOW);
    assert.equal(shown.short, "Connection lost → waiting on you");
    assert.equal(shown.tone, "error");
    assert.ok(shown.details.includes("Reason: host-daemon-restarted (host-connection-lost)"));
    assert.ok(shown.details.includes("Auto-resume: not resumed: it was waiting on your answer"));
  });

  test("ago", () => {
    assert.equal(ago(NOW, NOW), "just now");
    assert.equal(ago(NOW - 59 * MIN, NOW), "59 min ago");
    assert.equal(ago(NOW - 3 * 60 * MIN, NOW), "3 h ago");
    assert.equal(ago(NOW - 72 * 60 * MIN, NOW), "3 d ago");
  });
});

describe("sidebar rows", () => {
  const row = (label: string): RowStatus => ({ icon: "Square", label, tone: "default" });

  test("set new and changed rows, clear gone ones, leave equal ones", () => {
    const applied = new Map([
      ["a", row("Stopped")],
      ["b", row("Stopped")],
      ["c", row("Stopped")],
    ]);
    const desired = new Map([
      ["a", row("Stopped")],
      ["b", row("Daemon restart")],
      ["d", row("Stopped")],
    ]);
    assert.deepEqual(rowStatusChanges(applied, desired), [
      ["b", row("Daemon restart")],
      ["d", row("Stopped")],
      ["c", null],
    ]);
  });

  test("batches", () => {
    assert.deepEqual(batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(batches([], 2), []);
  });
});
