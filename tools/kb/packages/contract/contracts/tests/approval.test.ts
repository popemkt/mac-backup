/**
 * The one approval resolver (DESIGN.md → Action registry → Approval): which
 * policy wins, when a declared approval can be lowered, and how a decision
 * becomes a refusal and a listing. That every surface reaches the same
 * outcome is the surface contract's.
 */
import { describe, expect, test } from "bun:test";
import type { ApprovalPolicy } from "@kb/model";
import {
  approvalRefusal,
  listedOn,
  resolveApproval,
  type ActionMode,
  type SurfaceWire,
} from "../src/index.ts";

const WRITE: ActionMode = { kind: "write" };
const READ: ActionMode = { kind: "read" };
const GATED: ActionMode = { kind: "write", approval: "required" };

let next = 0;
function policy(
  match: string,
  decision: ApprovalPolicy["decision"],
  actor: ApprovalPolicy["actor"] = null,
): ApprovalPolicy {
  next += 1;
  return { id: `p${next}`, match, actor, decision };
}

const decide = (
  policies: readonly ApprovalPolicy[],
  id: string,
  mode: ActionMode,
  actor?: ApprovalPolicy["actor"],
) => resolveApproval(policies, { id, mode }, actor ?? undefined);

describe("resolveApproval", () => {
  test("with no policy, the action's mode decides", () => {
    expect(decide([], "node.add", WRITE)).toEqual({ decision: "allow", policy: null });
    expect(decide([], "ext.x.stamp", GATED)).toEqual({ decision: "ask", policy: null });
  });

  test("the most specific match wins: the id, then a pattern by its literals, then a mode, then *", () => {
    const star = policy("*", "deny");
    const mode = policy("every write", "ask");
    const broad = policy("node.*", "allow");
    const narrow = policy("node.de*", "deny");
    const exact = policy("node.delete", "allow");
    const all = [star, mode, broad, narrow, exact];
    expect(decide(all, "node.delete", WRITE)).toEqual({ decision: "allow", policy: exact.id });
    expect(decide(all, "node.describe", WRITE)).toEqual({ decision: "deny", policy: narrow.id });
    expect(decide(all, "node.add", WRITE)).toEqual({ decision: "allow", policy: broad.id });
    expect(decide(all, "graph.query", READ)).toEqual({ decision: "deny", policy: star.id });
    expect(decide(all, "tag.define", WRITE)).toEqual({ decision: "ask", policy: mode.id });
  });

  test("a pattern's dots are literal, and a mode word matches only its mode", () => {
    expect(decide([policy("node.*", "deny")], "nodeXadd", WRITE).policy).toBeNull();
    expect(decide([policy("every write", "deny")], "node.get", READ).policy).toBeNull();
    expect(decide([policy("every read", "deny")], "node.get", READ).decision).toBe("deny");
  });

  test("a policy naming the actor beats one naming none; a call naming none meets only those", () => {
    const anyone = policy("node.delete", "allow");
    const agent = policy("node.delete", "ask", "agent");
    expect(decide([anyone, agent], "node.delete", WRITE, "agent").policy).toBe(agent.id);
    expect(decide([anyone, agent], "node.delete", WRITE, "cli").policy).toBe(anyone.id);
    expect(decide([agent], "node.delete", WRITE).policy).toBeNull();
  });

  test("two policies that tie decide the stricter, in either order", () => {
    const allow = policy("node.delete", "allow", "agent");
    const deny = policy("node.delete", "deny", "agent");
    expect(decide([allow, deny], "node.delete", WRITE, "agent").decision).toBe("deny");
    expect(decide([deny, allow], "node.delete", WRITE, "agent").decision).toBe("deny");
  });

  test("only a policy naming the action lowers its declared approval; any policy may raise it", () => {
    const pattern = policy("ext.*", "allow", "agent");
    const exact = policy("ext.x.stamp", "allow", "cli");
    const both = [pattern, exact];
    expect(decide(both, "ext.x.stamp", GATED, "agent")).toEqual({
      decision: "ask",
      policy: pattern.id,
    });
    expect(decide(both, "ext.x.stamp", GATED, "cli")).toEqual({
      decision: "allow",
      policy: exact.id,
    });
    expect(decide([policy("ext.*", "deny")], "ext.x.stamp", GATED).decision).toBe("deny");
  });
});

describe("approvalRefusal", () => {
  test("a denied call is forbidden, whoever stands behind it", () => {
    const refusal = approvalRefusal(
      { decision: "deny", policy: "p" },
      { id: "node.delete", input: {}, approved: true, actor: "human" },
    );
    expect(refusal).toMatchObject({
      status: "failed",
      code: "forbidden",
      details: { policy: "p" },
    });
  });

  test("a call that asks runs with a person behind it: approved, or a human's own gesture", () => {
    const asks = { decision: "ask", policy: "p" } as const;
    expect(
      approvalRefusal(asks, { id: "a", input: {}, approved: true, actor: "agent" }),
    ).toBeNull();
    expect(approvalRefusal(asks, { id: "a", input: {}, actor: "human" })).toBeNull();
    expect(approvalRefusal(asks, { id: "a", input: {}, actor: "cli" })).toMatchObject({
      code: "approval_required",
      details: { policy: "p" },
    });
    expect(approvalRefusal({ decision: "ask", policy: null }, { id: "a", input: {} })).toEqual({
      status: "failed",
      id: "a",
      code: "approval_required",
      message: "action a requires approval; this call has none",
      details: undefined,
    });
  });

  test("an allowed call is never refused", () => {
    expect(approvalRefusal({ decision: "allow", policy: null }, { id: "a", input: {} })).toBeNull();
  });
});

describe("listedOn", () => {
  const carries: SurfaceWire = { carriesApproval: true, actor: "agent" };
  const cannot: SurfaceWire = { carriesApproval: false, actor: "agent" };
  test("a surface lists what can succeed on its wire", () => {
    expect([
      listedOn(carries, "allow"),
      listedOn(carries, "ask"),
      listedOn(carries, "deny"),
    ]).toEqual([true, true, false]);
    expect([listedOn(cannot, "allow"), listedOn(cannot, "ask"), listedOn(cannot, "deny")]).toEqual([
      true,
      false,
      false,
    ]);
  });
});
