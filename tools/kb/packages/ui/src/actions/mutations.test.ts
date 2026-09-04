import { beforeEach, describe, expect, it, vi } from "vitest";
import { present } from "@kb/model";
import { setPostAction } from "@/api/action";
import { runOptimistic } from "@/actions/optimistic";
import { planIndent, planOutdent, planUpdateText } from "@/actions/plan";
import { fixtureGraph } from "@/fixtures/graph";
import { formatRefToken, insertRefAtCursor } from "@/lib/refs";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

function seed(source: "api" | "fixtures" = "fixtures") {
  useOutlineStore
    .getState()
    .hydrateFromWire(structuredClone(fixtureGraph.nodes), fixtureGraph.rev, source);
}

describe("applyTx", () => {
  beforeEach(() => {
    useOutlineStore.setState({
      nodes: new Map(),
      wireNodes: [],
      queryDb: null,
      rev: 0,
      rootNodeId: WORKSPACE_ROOT_ID,
      homeRootId: WORKSPACE_ROOT_ID,
      activeNodeId: null,
      activeInstanceKey: null,
      selectedNodeId: null,
      selectedInstanceKey: null,
      cursorPosition: 0,
      loadSource: null,
      loadError: null,
    });
    setPostAction(null);
  });

  it("upserts and deletes into wire + outline + query db", () => {
    seed();
    useOutlineStore.getState().applyTx(
      [
        {
          id: "n.root-b",
          text: "updated search node",
          props: {},
          children: [],
          createdAt: "2026-08-08T05:00:00.000Z",
          updatedAt: "2026-08-08T06:00:00.000Z",
        },
      ],
      ["n.root-c"],
      { rev: 9 },
    );
    const s = useOutlineStore.getState();
    expect(s.rev).toBe(9);
    expect(s.nodes.get("n.root-b")?.text).toBe("updated search node");
    expect(s.nodes.has("n.root-c")).toBe(false);
    expect(s.queryDb?.nodes.has("n.root-b")).toBe(true);
    expect(s.queryDb?.nodes.has("n.root-c")).toBe(false);
  });
});

describe("optimistic apply/revert", () => {
  beforeEach(() => {
    seed("api");
    setPostAction(null);
  });

  it("keeps local tx when action succeeds", async () => {
    const post = vi.fn(async () => ({
      status: "succeeded" as const,
      id: "node.update",
      output: {},
    }));
    setPostAction(post);

    const plan = planUpdateText(useOutlineStore.getState().wireNodes, "n.root-a", "optimistic ok");
    const result = await runOptimistic(plan);
    expect(result.ok).toBe(true);
    expect(useOutlineStore.getState().nodes.get("n.root-a")?.text).toBe("optimistic ok");
    expect(post).toHaveBeenCalledWith({
      id: "node.update",
      input: { id: "n.root-a", text: "optimistic ok" },
    });
  });

  it("reverts wire snapshot when action fails", async () => {
    setPostAction(async () => ({
      status: "failed",
      id: "node.update",
      code: "internal",
      message: "boom",
    }));

    const before = present(useOutlineStore.getState().nodes.get("n.root-a"), "n.root-a").text;
    const plan = planUpdateText(useOutlineStore.getState().wireNodes, "n.root-a", "should bounce");
    const result = await runOptimistic(plan);
    expect(result.ok).toBe(false);
    expect(useOutlineStore.getState().nodes.get("n.root-a")?.text).toBe(before);
  });
});

describe("indent/outdent action mapping", () => {
  it("indent maps to node.update parent=prevSibling", () => {
    const plan = present(planIndent(fixtureGraph.nodes, "n.child-a2"), "indent plan");
    expect(plan.actions).toEqual([
      {
        id: "node.update",
        input: { id: "n.child-a2", parent: "n.child-a1", position: 0 },
      },
    ]);
    const parent = plan.upserts.find((n) => n.id === "n.child-a1");
    expect(parent?.children).toContain("n.child-a2");
    const old = plan.upserts.find((n) => n.id === "n.root-a");
    expect(old?.children).toEqual(["n.child-a1"]);
  });

  it("outdent maps to node.update under grandparent after parent", () => {
    const plan = present(planOutdent(fixtureGraph.nodes, "n.grandchild"), "outdent plan");
    expect(plan.actions).toEqual([
      {
        id: "node.update",
        input: { id: "n.grandchild", parent: "n.root-a", position: 2 },
      },
    ]);
  });
});

describe("autocomplete insertion", () => {
  it("formats [[id|label]] tokens", () => {
    expect(formatRefToken("n.root-a", "Ship kb ui shell")).toBe("[[n.root-a|Ship kb ui shell]]");
  });

  it("replaces open [[query at cursor", () => {
    const text = "see [[ship";
    const result = insertRefAtCursor(text, text.length, "n.root-a", "Ship");
    expect(result).toEqual({
      text: "see [[n.root-a|Ship]]",
      cursor: "see [[n.root-a|Ship]]".length,
    });
  });

  it("returns null when no open ref trigger", () => {
    expect(insertRefAtCursor("plain", 5, "n.root-a", "x")).toBeNull();
  });
});

describe("multi-valued prop semantics", () => {
  it("planSetProp with oldValue emits unset of old plus set of new", async () => {
    const { planSetProp } = await import("@/actions/plan");
    const store = useOutlineStore.getState();
    const nodes = store.wireNodes;
    const target = present(
      nodes.find((n) => Object.keys(n.props).length > 0),
      "node with props",
    );
    const fieldId = present(Object.keys(target.props).at(0), "first prop field");
    const fieldValues = present(target.props[fieldId], fieldId);
    const oldValue = present(fieldValues.at(0), "first prop value");
    const next = { t: "str" as const, v: "changed-value" };

    const plan = present(planSetProp(nodes, target.id, fieldId, next, oldValue), "set-prop plan");
    const input = present(plan.actions.at(0), "set-prop action").input as {
      setProps?: unknown[];
      unsetProps?: unknown[];
    };
    expect(input.unsetProps?.length ?? 0).toBeGreaterThan(0);
    expect(input.setProps?.length ?? 0).toBeGreaterThan(0);

    const upsert = present(
      plan.upserts.find((n) => n.id === target.id),
      `upsert ${target.id}`,
    );
    const values = present(upsert.props[fieldId], fieldId);
    expect(values).toContainEqual(next);
    expect(values).not.toContainEqual(oldValue);
  });
});
