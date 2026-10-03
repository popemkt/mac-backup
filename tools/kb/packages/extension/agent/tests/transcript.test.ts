import { describe, expect, test } from "bun:test";
import { failed, succeeded } from "@kb/contracts";
import {
  newTranscript,
  withDecision,
  withDisconnect,
  withEvent,
  withSent,
  type AgentEvent,
  type Transcript,
} from "../src/index.ts";

const K = "k1";

function play(transcript: Transcript, events: readonly AgentEvent[]): Transcript {
  return events.reduce(withEvent, transcript);
}

describe("the sidebar's transcript", () => {
  test("streamed text joins one reply until a tool call splits it", () => {
    const t = play(withSent(newTranscript(K), "hi"), [
      { type: "text", conversation: K, delta: "Hel" },
      { type: "text", conversation: K, delta: "lo" },
      {
        type: "tool-call",
        conversation: K,
        call: "c1",
        action: "node.get",
        title: "Get node",
        input: {},
      },
      { type: "tool-result", conversation: K, call: "c1", receipt: succeeded("node.get", {}) },
      { type: "text", conversation: K, delta: "Done." },
      { type: "turn-end", conversation: K, outcome: "done" },
    ]);
    expect(t.running).toBe(false);
    expect(t.entries.map((entry) => entry.kind)).toEqual(["user", "agent", "tool", "agent"]);
    expect(t.entries[1]).toMatchObject({ text: "Hello" });
    expect(t.entries[2]).toMatchObject({ state: "done", receipt: succeeded("node.get", {}) });
  });

  test("a call the invoke core asks about waits, then records the person's choice and its receipt", () => {
    let t = play(withSent(newTranscript(K), "stamp"), [
      {
        type: "tool-call",
        conversation: K,
        call: "c1",
        action: "ext.gated.stamp",
        title: "Stamp",
        input: {},
      },
      { type: "approval", conversation: K, call: "c1" },
    ]);
    expect(t.entries[1]).toMatchObject({ state: "awaiting", approval: true, decision: null });
    t = withDecision(t, "c1", "declined");
    expect(t.entries[1]).toMatchObject({ state: "deciding", decision: "declined" });
    const refused = failed("ext.gated.stamp", "approval_required", "needs approval");
    t = withEvent(t, { type: "tool-result", conversation: K, call: "c1", receipt: refused });
    expect(t.entries[1]).toMatchObject({ state: "done", decision: "declined", receipt: refused });
  });

  test("a turn that stops leaves its open calls stopped and says why", () => {
    const open: AgentEvent = {
      type: "tool-call",
      conversation: K,
      call: "c1",
      action: "ext.gated.stamp",
      title: "Stamp",
      input: {},
    };
    const cancelled = play(withSent(newTranscript(K), "x"), [
      open,
      { type: "approval", conversation: K, call: "c1" },
      { type: "turn-end", conversation: K, outcome: "cancelled" },
    ]);
    expect(cancelled.entries[1]).toMatchObject({ state: "stopped" });
    expect(cancelled.entries.at(-1)).toMatchObject({ kind: "notice", text: "Stopped." });
    const failedTurn = withEvent(withSent(newTranscript(K), "x"), {
      type: "turn-end",
      conversation: K,
      outcome: "failed",
      message: "not logged in",
    });
    expect(failedTurn.entries.at(-1)).toMatchObject({ tone: "error", text: "not logged in" });
    const dropped = withDisconnect(play(withSent(newTranscript(K), "x"), [open]));
    expect(dropped.running).toBe(false);
    expect(dropped.entries[1]).toMatchObject({ state: "stopped" });
    expect(withDisconnect(newTranscript(K))).toEqual(newTranscript(K));
  });

  test("events of another conversation change nothing", () => {
    const t = withSent(newTranscript(K), "hi");
    expect(withEvent(t, { type: "text", conversation: "other", delta: "x" })).toBe(t);
  });
});
