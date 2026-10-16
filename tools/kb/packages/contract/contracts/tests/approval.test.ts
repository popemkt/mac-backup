/**
 * The one approval resolver (DESIGN.md → Action registry → Approval): which
 * policy wins, when a declared approval can be lowered, why a write to a
 * policy always asks, and how a decision becomes a refusal and a listing.
 * That every surface reaches the same outcome is the surface contract's.
 */
import { describe, expect, test } from "bun:test";
import {
  ACTOR_OPTION_IDS,
  SYSTEM_IDS,
  approvalPolicyNode,
  extensionNodeId,
  type ApprovalPolicy,
  type KbNode,
  type NodeWrite,
} from "@kb/model";
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
  writes?: readonly NodeWrite[],
) => resolveApproval(policies, { action: { id, mode }, actor: actor ?? undefined, writes });

const node = (id: string, props: KbNode["props"] = {}): KbNode => ({
  id,
  text: id,
  props,
  children: [],
  createdAt: "",
  updatedAt: "",
});

describe("resolveApproval", () => {
  test("with no policy, the action's mode decides", () => {
    expect(decide([], "node.add", WRITE)).toEqual({ decision: "allow", by: "mode" });
    expect(decide([], "ext.x.stamp", GATED)).toEqual({ decision: "ask", by: "mode" });
  });

  test("the most specific match wins: the id, then a pattern by its literals, then a mode, then *", () => {
    const star = policy("*", "deny");
    const mode = policy("every write", "ask");
    const broad = policy("node.*", "allow");
    const narrow = policy("node.de*", "deny");
    const exact = policy("node.delete", "allow");
    const all = [star, mode, broad, narrow, exact];
    expect(decide(all, "node.delete", WRITE)).toEqual({
      decision: "allow",
      by: { policy: exact.id },
    });
    expect(decide(all, "node.describe", WRITE)).toEqual({
      decision: "deny",
      by: { policy: narrow.id },
    });
    expect(decide(all, "node.add", WRITE)).toEqual({ decision: "allow", by: { policy: broad.id } });
    expect(decide(all, "graph.query", READ)).toEqual({ decision: "deny", by: { policy: star.id } });
    expect(decide(all, "tag.define", WRITE)).toEqual({ decision: "ask", by: { policy: mode.id } });
  });

  test("a pattern's dots are literal, and a mode word matches only its mode", () => {
    expect(decide([policy("node.*", "deny")], "nodeXadd", WRITE).by).toBe("mode");
    expect(decide([policy("every write", "deny")], "node.get", READ).by).toBe("mode");
    expect(decide([policy("every read", "deny")], "node.get", READ).decision).toBe("deny");
  });

  test("a policy naming the actor beats one naming none; a call naming none meets only those", () => {
    const anyone = policy("node.delete", "allow");
    const agent = policy("node.delete", "ask", "agent");
    expect(decide([anyone, agent], "node.delete", WRITE, "agent").by).toEqual({ policy: agent.id });
    expect(decide([anyone, agent], "node.delete", WRITE, "cli").by).toEqual({ policy: anyone.id });
    expect(decide([agent], "node.delete", WRITE).by).toBe("mode");
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
      by: { policy: pattern.id },
    });
    expect(decide(both, "ext.x.stamp", GATED, "cli")).toEqual({
      decision: "allow",
      by: { policy: exact.id },
    });
    expect(decide([policy("ext.*", "deny")], "ext.x.stamp", GATED).decision).toBe("deny");
  });

  test("a write to a policy, or to what policies are written in, asks whatever the policies say", () => {
    const allowAll = [policy("*", "allow")];
    const existing = approvalPolicyNode(node("p.one"), {
      match: "node.delete",
      actor: "agent",
      decision: "ask",
    });
    const asks = { decision: "ask", by: { writes: "approval-policy" } } as const;
    const writes: Record<string, NodeWrite> = {
      edit: { before: existing, after: { ...existing, text: "edited" } },
      remove: { before: existing, after: undefined },
      untag: { before: existing, after: node("p.one") },
      tag: {
        before: node("n.x"),
        after: approvalPolicyNode(node("n.x"), { match: "*", actor: null, decision: "allow" }),
      },
      option: { before: node(ACTOR_OPTION_IDS.agent), after: node(ACTOR_OPTION_IDS.agent) },
      field: { before: node(SYSTEM_IDS.approvalDecisionField), after: undefined },
    };
    for (const [kind, write] of Object.entries(writes)) {
      expect({ kind, ...decide(allowAll, "node.update", WRITE, "agent", [write]) }).toEqual({
        kind,
        ...asks,
      });
    }
    // Any other write is the policies' to decide, and a denial stays one.
    const plain = { before: node("n.y"), after: node("n.y") };
    expect(decide(allowAll, "node.update", WRITE, "agent", [plain]).decision).toBe("allow");
    expect(
      decide([policy("*", "deny")], "node.update", WRITE, "agent", [writes.edit as NodeWrite])
        .decision,
    ).toBe("deny");
  });
});

describe("a write to configuration", () => {
  const AGENT = extensionNodeId("agent");
  const configuresAgent = { [SYSTEM_IDS.configuresField]: [{ t: "ref" as const, v: AGENT }] };
  const GRAPH = new Map<string, KbNode>([
    ["sys.tag.provider", node("sys.tag.provider", configuresAgent)],
    ["sys.f.provider", node("sys.f.provider", configuresAgent)],
  ]);
  const provider = node("n.p", { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "sys.tag.provider" }] });
  const writes: Record<string, NodeWrite> = {
    mint: { before: undefined, after: provider },
    edit: { before: provider, after: { ...provider, text: "elsewhere" } },
    untag: { before: provider, after: node("n.p") },
    select: {
      before: node(AGENT),
      after: node(AGENT, { "sys.f.provider": [{ t: "ref", v: "n.p" }] }),
    },
  };
  const weigh = (actor: ApprovalPolicy["actor"], write: NodeWrite) =>
    resolveApproval([policy("*", "allow")], {
      action: { id: "node.update", mode: WRITE },
      actor: actor ?? undefined,
      writes: [write],
      nodeOf: (id) => GRAPH.get(id),
    });

  test("asks a caller acting for the owner, whatever the policies say", () => {
    for (const [kind, write] of Object.entries(writes)) {
      for (const actor of ["agent", "script"] as const) {
        expect({ kind, actor, ...weigh(actor, write) }).toEqual({
          kind,
          actor,
          decision: "ask",
          by: { writes: "configuration" },
        });
      }
    }
  });

  test("is the owner's own to make, and any other write stays the policies'", () => {
    for (const write of Object.values(writes)) {
      for (const actor of ["human", "cli", null] as const) {
        expect(weigh(actor, write).decision).toBe("allow");
      }
    }
    expect(weigh("agent", { before: node("n.q"), after: node("n.q", {}) }).decision).toBe("allow");
  });

  test("names the actor and the owner in its refusal", () => {
    expect(
      approvalRefusal(
        { decision: "ask", by: { writes: "configuration" } },
        { id: "node.update", input: {}, actor: "agent" },
      ),
    ).toMatchObject({
      code: "approval_required",
      message: expect.stringContaining("only with the owner's approval"),
      details: { writes: "configuration" },
    });
  });
});

describe("approvalRefusal", () => {
  test("a denied call is forbidden, whoever stands behind it", () => {
    const refusal = approvalRefusal(
      { decision: "deny", by: { policy: "p" } },
      { id: "node.delete", input: {}, approved: true, actor: "human" },
    );
    expect(refusal).toMatchObject({ code: "forbidden", details: { policy: "p" } });
  });

  test("a call that asks runs with a person behind it: approved, or a human's own gesture", () => {
    const asks = { decision: "ask", by: { policy: "p" } } as const;
    expect(
      approvalRefusal(asks, { id: "a", input: {}, approved: true, actor: "agent" }),
    ).toBeNull();
    expect(approvalRefusal(asks, { id: "a", input: {}, actor: "human" })).toBeNull();
    expect(approvalRefusal(asks, { id: "a", input: {}, actor: "cli" })).toMatchObject({
      code: "approval_required",
      details: { policy: "p" },
    });
    expect(approvalRefusal({ decision: "ask", by: "mode" }, { id: "a", input: {} })).toEqual({
      code: "approval_required",
      message: "action a requires approval; this call has none",
    });
    expect(
      approvalRefusal(
        { decision: "ask", by: { writes: "approval-policy" } },
        { id: "a", input: {}, actor: "cli" },
      ),
    ).toMatchObject({ code: "approval_required", details: { writes: "approval-policy" } });
  });

  test("an allowed call is never refused", () => {
    expect(approvalRefusal({ decision: "allow", by: "mode" }, { id: "a", input: {} })).toBeNull();
  });
});

describe("listedOn", () => {
  const carries: SurfaceWire = { carriesApproval: true, actor: "agent" };
  const cannot: SurfaceWire = { carriesApproval: false, actor: "agent" };
  test("a surface lists what can succeed on its wire", () => {
    const decisions = ["allow", "ask", "deny"] as const;
    expect(decisions.map((decision) => listedOn(carries, decision))).toEqual([true, true, false]);
    expect(decisions.map((decision) => listedOn(cannot, decision))).toEqual([true, false, false]);
  });
});

describe("a batch is decided as the actions it is a batch of", () => {
  const batch = (policies: readonly ApprovalPolicy[], actor?: ApprovalPolicy["actor"]) =>
    resolveApproval(policies, {
      action: { id: "node.addTree", mode: WRITE, batchOf: [{ id: "node.add", mode: WRITE }] },
      actor: actor ?? undefined,
    });

  test("a policy on a batched action governs the batch, by that policy", () => {
    const ask = policy("node.add", "ask");
    expect(batch([ask])).toEqual({ decision: "ask", by: { policy: ask.id } });
    const deny = policy("node.add", "deny", "agent");
    expect(batch([deny], "agent").decision).toBe("deny");
    expect(batch([deny], "cli").decision).toBe("allow");
  });

  test("the stricter of the batch's own decision and its parts' holds", () => {
    expect(batch([policy("node.add", "ask"), policy("node.addTree", "allow")]).decision).toBe(
      "ask",
    );
    expect(batch([policy("node.add", "allow"), policy("node.addTree", "deny")]).decision).toBe(
      "deny",
    );
    expect(batch([]).decision).toBe("allow");
  });

  test("each part is decided with its own mode, not the batch's", () => {
    const of = (part: ActionMode) =>
      resolveApproval([], {
        action: { id: "x.batch", mode: WRITE, batchOf: [{ id: "x.part", mode: part }] },
        actor: "agent",
      });
    // The part's declared approval is a floor the batch inherits.
    expect(of(GATED)).toEqual({ decision: "ask", by: "mode" });
    expect(of(WRITE).decision).toBe("allow");
    // A mode word matches the part by the part's mode.
    const denyReads = policy("every read", "deny");
    const read = resolveApproval([denyReads], {
      action: { id: "x.batch", mode: WRITE, batchOf: [{ id: "x.part", mode: READ }] },
      actor: "agent",
    });
    expect(read).toEqual({ decision: "deny", by: { policy: denyReads.id } });
    expect(decide([denyReads], "x.batch", WRITE, "agent").decision).toBe("allow");
  });
});
