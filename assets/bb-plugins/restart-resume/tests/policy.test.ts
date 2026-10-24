// The resume policy: which interruption is resumed, the cap, the dedup, and settings parsing.
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  anyTurnCompleted,
  boundaryOf,
  continuationText,
  decide,
  DEFAULTS,
  parentCovers,
  parseRecord,
  parseSettings,
  wasWaitingOnUser,
  type ResumeRecord,
  type Settings,
  type ThreadFacts,
} from "../core/policy.ts";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const settings: Settings = parseSettings({});

const interrupted = (over: Partial<{ seq: number; at: number; reason: string }> = {}): ThreadFacts["boundary"] => ({
  kind: "interrupted",
  seq: over.seq ?? 40,
  at: over.at ?? NOW - 2 * MIN,
  reason: over.reason ?? "host-daemon-restarted",
});

const facts = (over: Partial<ThreadFacts> = {}): ThreadFacts => ({
  status: "error",
  archived: false,
  boundary: interrupted(),
  completedSinceRecord: false,
  waitingOnUser: false,
  parentCovers: false,
  ...over,
});

describe("which interruption is resumed", () => {
  test("a recent restart interruption of a failed thread is resumed, first of the chain", () => {
    assert.deepEqual(decide(facts(), null, settings, NOW), {
      action: "resume",
      record: { chain: 1, interruptionSeq: 40, resumedAt: NOW },
    });
  });

  test("a stop by a person or agent, a removed machine and an idle provider are never resumed", () => {
    for (const reason of ["manual-stop", "host-removed", "provider-turn-idle"]) {
      assert.deepEqual(decide(facts({ boundary: interrupted({ reason }) }), null, settings, NOW), {
        action: "skip",
        reason: "not-a-restart",
      });
    }
  });

  test("a thread that failed for another reason, or moved on since, is left alone", () => {
    assert.equal(decide(facts({ boundary: { kind: "other", seq: 41 } }), null, settings, NOW).action, "skip");
    assert.equal(decide(facts({ boundary: null }), null, settings, NOW).action, "skip");
    for (const status of ["idle", "active", "starting", "stopping", "pending"]) {
      assert.deepEqual(decide(facts({ status }), null, settings, NOW), { action: "skip", reason: "not-failed" });
    }
    assert.deepEqual(decide(facts({ archived: true }), null, settings, NOW), { action: "skip", reason: "archived" });
  });

  test("only interruptions inside the window", () => {
    const edge = facts({ boundary: interrupted({ at: NOW - 30 * MIN }) });
    assert.equal(decide(edge, null, settings, NOW).action, "resume");
    const old = facts({ boundary: interrupted({ at: NOW - 30 * MIN - 1 }) });
    assert.deepEqual(decide(old, null, settings, NOW), { action: "skip", reason: "stale" });
  });

  test("the global switch", () => {
    assert.deepEqual(decide(facts(), null, parseSettings({ enabled: false }), NOW), {
      action: "skip",
      reason: "disabled",
    });
  });
});

describe("dedup and the cap", () => {
  const record = (chain: number, interruptionSeq: number): ResumeRecord => ({ chain, interruptionSeq, resumedAt: NOW - MIN });

  test("an interruption already resumed is never resumed again", () => {
    assert.deepEqual(decide(facts(), record(1, 40), settings, NOW), { action: "skip", reason: "already-resumed" });
    assert.deepEqual(decide(facts(), record(1, 45), settings, NOW), { action: "skip", reason: "already-resumed" });
  });

  test("a new interruption with no completed turn continues the chain, up to the cap", () => {
    const next = decide(facts({ boundary: interrupted({ seq: 60 }) }), record(2, 40), settings, NOW);
    assert.deepEqual(next, { action: "resume", record: { chain: 3, interruptionSeq: 60, resumedAt: NOW } });
    assert.deepEqual(decide(facts({ boundary: interrupted({ seq: 80 }) }), record(3, 60), settings, NOW), {
      action: "skip",
      reason: "cap-reached",
    });
  });

  test("a completed turn in between resets the chain", () => {
    const after = facts({ boundary: interrupted({ seq: 80 }), completedSinceRecord: true });
    assert.deepEqual(decide(after, record(3, 60), settings, NOW), {
      action: "resume",
      record: { chain: 1, interruptionSeq: 80, resumedAt: NOW },
    });
  });

  test("the cap is a setting", () => {
    const one = parseSettings({ maxConsecutive: 1 });
    assert.equal(decide(facts({ boundary: interrupted({ seq: 60 }) }), record(1, 40), one, NOW).action, "skip");
  });
});

describe("a thread that was waiting on the person", () => {
  const lifecycle = (seq: number, id: string, status: string) => ({
    seq,
    type: "system/interaction/lifecycle",
    createdAt: seq,
    data: { interaction: { id, status, statusReason: null } },
  });

  test("is not resumed", () => {
    assert.deepEqual(decide(facts({ waitingOnUser: true }), null, settings, NOW), {
      action: "skip",
      reason: "waiting-on-user",
    });
  });

  test("an interaction cut open counts; one answered before the cut does not", () => {
    assert.equal(wasWaitingOnUser([lifecycle(1, "pi_1", "pending"), lifecycle(5, "pi_1", "interrupted")]), true);
    assert.equal(wasWaitingOnUser([lifecycle(1, "pi_1", "pending")]), true);
    assert.equal(wasWaitingOnUser([lifecycle(1, "pi_1", "pending"), lifecycle(3, "pi_1", "resolved")]), false);
    assert.equal(
      wasWaitingOnUser([lifecycle(1, "pi_1", "resolved"), lifecycle(4, "pi_2", "pending"), lifecycle(6, "pi_2", "interrupted")]),
      true,
    );
    assert.equal(wasWaitingOnUser([]), false);
  });

  test("the older per-kind lifecycle events are read too, in any order", () => {
    const question = (seq: number, status: string) => ({
      seq,
      type: "system/userQuestion/lifecycle",
      createdAt: seq,
      data: { interactionId: "pi_q", status },
    });
    assert.equal(wasWaitingOnUser([question(9, "interrupted"), question(2, "pending")]), true);
    assert.equal(wasWaitingOnUser([question(9, "resolved"), question(2, "pending")]), false);
  });
});

describe("a child and its parent", () => {
  const resume = decide(facts(), null, settings, NOW);

  test("a child whose parent covers it is not resumed; the parent re-drives it", () => {
    assert.deepEqual(decide(facts({ parentCovers: true }), null, settings, NOW), {
      action: "skip",
      reason: "parent-resumes",
    });
  });

  test("a parent covers when it is resumed now, was resumed inside the window, or is covered itself", () => {
    assert.equal(parentCovers(resume, null, settings, NOW), true);
    assert.equal(parentCovers({ action: "skip", reason: "parent-resumes" }, null, settings, NOW), true);
    const recent: ResumeRecord = { chain: 1, interruptionSeq: 40, resumedAt: NOW - 5 * MIN };
    assert.equal(parentCovers({ action: "skip", reason: "already-resumed" }, recent, settings, NOW), true);
  });

  test("a parent that is not resumed leaves the child to be resumed", () => {
    for (const reason of ["not-failed", "not-a-restart", "stale", "cap-reached", "waiting-on-user", "archived"] as const) {
      assert.equal(parentCovers({ action: "skip", reason }, null, settings, NOW), false, reason);
    }
    const old: ResumeRecord = { chain: 1, interruptionSeq: 40, resumedAt: NOW - 31 * MIN };
    assert.equal(parentCovers({ action: "skip", reason: "already-resumed" }, old, settings, NOW), false);
  });

  test("an otherwise skipped child keeps its own reason", () => {
    assert.deepEqual(decide(facts({ parentCovers: true, waitingOnUser: true }), null, settings, NOW), {
      action: "skip",
      reason: "waiting-on-user",
    });
  });
});

describe("reading events", () => {
  test("the newest boundary is an interruption only when it is the interrupted event", () => {
    assert.deepEqual(
      boundaryOf({ seq: 7, type: "system/thread/interrupted", createdAt: 5, data: { reason: "host-daemon-restarted", cause: "host-connection-lost" } }),
      { kind: "interrupted", seq: 7, at: 5, reason: "host-daemon-restarted" },
    );
    assert.deepEqual(boundaryOf({ seq: 8, type: "client/turn/requested", createdAt: 6, data: {} }), { kind: "other", seq: 8 });
    assert.equal(boundaryOf(undefined), null);
    assert.equal((boundaryOf({ seq: 9, type: "system/thread/interrupted", createdAt: 1, data: null }) as { reason: string }).reason, "unknown");
  });

  test("only a turn that completed normally counts as completed", () => {
    const row = (status: string) => ({ seq: 1, type: "turn/completed", createdAt: 1, data: { status } });
    assert.equal(anyTurnCompleted([row("interrupted"), row("failed")]), false);
    assert.equal(anyTurnCompleted([row("interrupted"), row("completed")]), true);
    assert.equal(anyTurnCompleted([]), false);
  });

  test("a stored record of the wrong shape reads as none", () => {
    assert.equal(parseRecord(undefined), null);
    assert.equal(parseRecord({ chain: "1", interruptionSeq: 1, resumedAt: 1 }), null);
    assert.deepEqual(parseRecord({ chain: 1, interruptionSeq: 2, resumedAt: 3 }), { chain: 1, interruptionSeq: 2, resumedAt: 3 });
  });
});

describe("settings and the message", () => {
  test("defaults, clamping and a blank message", () => {
    assert.deepEqual(parseSettings({}), {
      enabled: true,
      windowMs: 30 * MIN,
      maxConsecutive: 3,
      message: DEFAULTS.message,
    });
    const odd = parseSettings({ windowMinutes: 0, maxConsecutive: 99, message: "   ", enabled: "yes" });
    assert.deepEqual(odd, { enabled: true, windowMs: MIN, maxConsecutive: 10, message: DEFAULTS.message });
    assert.equal(parseSettings({ windowMinutes: Number.NaN }).windowMs, 30 * MIN);
  });

  test("the continuation says what sent it and where the chain stands", () => {
    const text = continuationText(parseSettings({ message: "Carry on." }), { chain: 2, interruptionSeq: 1, resumedAt: 0 });
    assert.equal(text, "Carry on.\n\n(auto-resumed after restart, 2 of 3)");
  });
});
