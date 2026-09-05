import { describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { fixtureGraph } from "@/fixtures/graph";
import { planDelete, planIndent, planMergeInto, planMove, planSetProp, planSplit } from "./plan";

describe("outline action input builders", () => {
  it("split keeps the expanded-first-child decision in the UI", () => {
    expect(
      planSplit(fixtureGraph.nodes, "n.root-a", 4, "new", {
        expandedIds: new Set(["n.root-a"]),
      }).actions,
    ).toEqual([
      { id: "node.update", input: { id: "n.root-a", text: "Ship" } },
      {
        id: "node.add",
        input: { id: "new", text: " kb ui shell", parent: "n.root-a", position: 0 },
      },
    ]);
  });

  it("delete delegates cascade semantics to node.update", () => {
    expect(planDelete(fixtureGraph.nodes, "n.root-a").actions).toEqual([
      { id: "node.update", input: { id: "n.root-a", delete: true, descendants: "cascade" } },
    ]);
  });

  it("indent and parented move emit positions, not rewritten parents", () => {
    expect(present(planIndent(fixtureGraph.nodes, "n.child-a2"), "indent").actions).toEqual([
      { id: "node.update", input: { id: "n.child-a2", parent: "n.child-a1", position: 0 } },
    ]);
    expect(present(planMove(fixtureGraph.nodes, "n.child-a2", "up"), "move").actions).toEqual([
      { id: "node.update", input: { id: "n.child-a2", position: 0 } },
    ]);
  });

  it("merge preserves UI focus metadata while actions own graph changes", () => {
    const merged = present(planMergeInto(fixtureGraph.nodes, "n.child-a2", "n.child-a1"), "merge");
    expect(merged.focusId).toBe("n.child-a1");
    expect(merged.actions.at(-1)).toEqual({
      id: "node.update",
      input: { id: "n.child-a2", delete: true },
    });
  });

  it("orders property replacement as canonical unset then set invocations", () => {
    expect(
      planSetProp(
        fixtureGraph.nodes,
        "n.root-a",
        "field",
        { t: "str", v: "new" },
        { t: "str", v: "old" },
      ).actions,
    ).toEqual([
      {
        id: "node.update",
        input: {
          id: "n.root-a",
          unsetProps: [{ field: "field", value: { t: "str", v: "old" } }],
        },
      },
      {
        id: "node.update",
        input: {
          id: "n.root-a",
          setProps: [{ field: "field", value: { t: "str", v: "new" } }],
        },
      },
    ]);
  });
});
