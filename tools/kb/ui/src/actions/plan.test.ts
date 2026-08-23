/**
 * r1-editor §5.1 — plan contract tests for Tana-grade split/merge/indent
 * semantics (D05, D07, D08, D09) plus undo inverse machinery (D19).
 */
import { describe, expect, it } from "vitest";
import {
  invertPlan,
  inversePlanActions,
  planIndent,
  planDelete,
  planMergeInto,
  planMergeWithPrevious,
  planSplit,
  type PlannedMutation,
} from "@/actions/plan";
import type { WireNode } from "@kb/protocol";

const ISO = "2026-08-08T05:00:00.000Z";

function node(id: string, text: string, children: string[] = []): WireNode {
  return {
    id,
    text,
    props: {},
    children,
    createdAt: ISO,
    updatedAt: ISO,
  };
}

/** Tree: root → [a (expanded, kids [a1, a2] where a2 has kid a2k), b (leaf)] */
function fixture(): WireNode[] {
  return [
    node("root", "Root", ["a", "b"]),
    node("a", "Alpha", ["a1", "a2"]),
    node("a1", "A-one"),
    node("a2", "A-two", ["a2k"]),
    node("a2k", "A-two-kid"),
    node("b", "Beta"),
  ];
}

describe("planSplit (D07)", () => {
  it("splitting an expanded parent inserts the new node as first child", () => {
    const nodes = fixture();
    const expandedIds = new Set(["root", "a"]);
    const plan = planSplit(nodes, "a", 5, "new", { expandedIds });

    const a = plan.upserts.find((n) => n.id === "a")!;
    expect(a.text).toBe("Alpha");
    expect(a.children).toEqual(["new", "a1", "a2"]);

    const created = plan.upserts.find((n) => n.id === "new")!;
    expect(created.text).toBe("");
    expect(plan.focusId).toBe("new");
    expect(plan.focusCursor).toBe(0);
    expect(plan.actions).toContainEqual({
      id: "node.add",
      input: { id: "new", text: "", parent: "a", position: 0 },
    });
  });

  it("splitting a mid-text expanded parent keeps left text on the parent", () => {
    const nodes = fixture();
    const expandedIds = new Set(["root", "a"]);
    const plan = planSplit(nodes, "a", 2, "new", { expandedIds });
    const a = plan.upserts.find((n) => n.id === "a")!;
    expect(a.text).toBe("Al");
    expect(a.children[0]).toBe("new");
    const created = plan.upserts.find((n) => n.id === "new")!;
    expect(created.text).toBe("pha");
  });

  it("splitting a collapsed parent inserts a sibling after it", () => {
    const nodes = fixture();
    // "a" has children but is NOT in the expanded set.
    const expandedIds = new Set<string>(["root"]);
    const plan = planSplit(nodes, "a", 5, "new", { expandedIds });
    const root = plan.upserts.find((n) => n.id === "root")!;
    expect(root.children).toEqual(["a", "new", "b"]);
    const a = plan.upserts.find((n) => n.id === "a")!;
    expect(a.children).toEqual(["a1", "a2"]);
  });

  it("splitting a leaf inserts a sibling after it (legacy path)", () => {
    const nodes = fixture();
    const plan = planSplit(nodes, "b", 1, "new", { expandedIds: new Set() });
    const root = plan.upserts.find((n) => n.id === "root")!;
    expect(root.children).toEqual(["a", "b", "new"]);
  });
});

describe("planIndent / collapse safety (D05)", () => {
  it("reparents under the previous sibling and reports the reveal target", () => {
    const nodes = fixture();
    const plan = planIndent(nodes, "b");
    expect(plan).not.toBeNull();
    const prev = plan!.upserts.find((n) => n.id === "a")!;
    expect(prev.children).toEqual(["a1", "a2", "b"]);
    const root = plan!.upserts.find((n) => n.id === "root")!;
    expect(root.children).toEqual(["a"]);
  });

  it("indenting a forest root uses forest order", () => {
    const roots: WireNode[] = [node("r1", "one"), node("r2", "two")];
    const plan = planIndent(roots, "r2");
    expect(plan).not.toBeNull();
    expect(plan!.upserts.find((n) => n.id === "r1")!.children).toEqual(["r2"]);
  });
});

describe("planMergeWithPrevious / planMergeInto (D08, D09)", () => {
  it("returns null for the first child — callers outdent or delete instead", () => {
    const plan = planMergeWithPrevious(fixture(), "a1");
    expect(plan).toBeNull();
  });

  it("returns null for forest roots", () => {
    const plan = planMergeWithPrevious(fixture(), "root");
    expect(plan).toBeNull();
  });

  it("merges into the array-level previous sibling by default", () => {
    const plan = planMergeWithPrevious(fixture(), "b");
    expect(plan).not.toBeNull();
    expect(plan!.focusId).toBe("a");
    expect(plan!.focusCursor).toBe("Alpha".length);
    const a = plan!.upserts.find((n) => n.id === "a")!;
    expect(a.text).toBe("AlphaBeta");
    expect(plan!.deletes).toEqual(["b"]);
  });

  it("merging into an expanded sibling's deepest last descendant (D09)", () => {
    // Visual predecessor of b is a2k (a expanded: a→a1→a2→a2k).
    const plan = planMergeInto(fixture(), "b", "a2k");
    expect(plan).not.toBeNull();
    const target = plan!.upserts.find((n) => n.id === "a2k")!;
    expect(target.text).toBe("A-two-kidBeta");
    // b removed from root; cross-parent structure handled.
    const root = plan!.upserts.find((n) => n.id === "root")!;
    expect(root.children).toEqual(["a"]);
    expect(plan!.focusCursor).toBe("A-two-kid".length);
  });

  it("merging adopts the source's children at the tail", () => {
    const plan = planMergeInto(fixture(), "a2", "a1");
    const a1 = plan!.upserts.find((n) => n.id === "a1")!;
    expect(a1.children).toEqual(["a2k"]);
    expect(a1.text).toBe("A-oneA-two");
  });

  it("refuses self-merge", () => {
    expect(planMergeInto(fixture(), "b", "b")).toBeNull();
  });
});

describe("invertPlan (D19)", () => {
  it("inverts a delete by restoring the pre-state subtree", () => {
    const nodes = fixture();
    const plan: PlannedMutation = {
      upserts: [node("root", "Root", ["a"])],
      deletes: ["b"],
      actions: [],
    };
    const inv = invertPlan(nodes, plan);
    expect(inv.deletes).toEqual([]);
    const restored = inv.upserts.find((n) => n.id === "b");
    expect(restored?.text).toBe("Beta");
    const rootBack = inv.upserts.find((n) => n.id === "root");
    expect(rootBack?.children).toEqual(["a", "b"]);
  });

  it("inverts a mint by deleting the new id", () => {
    const nodes = fixture();
    const plan: PlannedMutation = {
      upserts: [node("minted", ""), node("root", "Root", ["a", "b", "minted"])],
      deletes: [],
      actions: [],
    };
    const inv = invertPlan(nodes, plan);
    expect(inv.deletes).toEqual(["minted"]);
    expect(inv.upserts.map((u) => u.id)).toContain("root");
    expect(inv.upserts.find((u) => u.id === "root")!.children).toEqual(["a", "b"]);
  });

  it("inverts a text edit to the prior payload", () => {
    const nodes = fixture();
    const plan: PlannedMutation = {
      upserts: [{ ...node("b", "Changed"), updatedAt: "later" }],
      deletes: [],
      actions: [],
    };
    const inv = invertPlan(nodes, plan);
    expect(inv.upserts.find((u) => u.id === "b")!.text).toBe("Beta");
  });

  it("round-trips: apply plan then inverse restores original wire", () => {
    const nodes = fixture();
    const plan = planSplit(nodes, "a", 5, "new", {
      expandedIds: new Set(["root", "a"]),
    });
    // Simulate local application via plain merge semantics.
    const applied = applyTxShim(nodes, plan);
    const inv = invertPlan(nodes, plan);
    const restored = applyInvShim(applied, inv);
    expect(restored.map((n) => n.id).sort()).toEqual(nodes.map((n) => n.id).sort());
    expect(restored.find((n) => n.id === "a")!.children).toEqual(["a1", "a2"]);
    expect(restored.find((n) => n.id === "root")!.children).toEqual(["a", "b"]);
  });
});

describe("inversePlanActions (D19 remote sync)", () => {
  it("restores hard-deleted ids with node.add and reverts survivors with node.update", () => {
    const nodes = fixture();
    const plan: PlannedMutation = {
      upserts: [node("root", "Root", ["a"]), { ...node("a", "AlphaChanged") }],
      deletes: ["b"],
      actions: [],
    };
    const inv = invertPlan(nodes, plan);
    const actions = inversePlanActions(nodes, plan, inv);
    // b was hard-deleted by the plan → undo re-adds it under its old parent.
    expect(actions).toContainEqual({
      id: "node.add",
      input: { id: "b", text: "Beta", parent: "root" },
    });
    // Surviving touched nodes revert text/structure in place.
    expect(actions).toContainEqual({
      id: "node.update",
      input: { id: "a", text: "Alpha", parent: "root" },
    });
    expect(actions.some((a) => JSON.stringify(a.input).includes("delete"))).toBe(false);
  });
});

describe("cascade delete (R9 B3)", () => {
  it("removes the complete subtree locally and declares cascade remotely", () => {
    const nodes = [node("root", "root", ["parent"]), node("parent", "p", ["child"]), node("child", "c")];
    const plan = planDelete(nodes, "parent");
    expect(plan.deletes).toEqual(["parent", "child"]);
    expect(plan.actions).toEqual([
      { id: "node.update", input: { id: "parent", delete: true, descendants: "cascade" } },
    ]);
  });
});

/** Minimal mergeTx stand-in (no sorting dependency). */
function applyTxShim(nodes: WireNode[], plan: PlannedMutation): WireNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const id of plan.deletes) byId.delete(id);
  for (const u of plan.upserts) byId.set(u.id, u);
  return [...byId.values()];
}

function applyInvShim(nodes: WireNode[], inv: ReturnType<typeof invertPlan>): WireNode[] {
  return applyTxShim(nodes, {
    upserts: inv.upserts,
    deletes: inv.deletes,
    actions: [],
  });
}
