import { beforeEach, describe, expect, it } from "vitest";
import { fixtureGraph } from "@/fixtures/graph";
import { useOutlineStore } from "@/stores/outline.store";
import { planAddTagField, planRemoveTag, planSetTagColor } from "@/actions/plan";

describe("tag chip actions (plan layer)", () => {
  beforeEach(() => {
    useOutlineStore.setState({
      nodes: new Map(),
      wireNodes: [],
      queryDb: null,
      rev: 0,
      rootNodeId: "__kb_root__",
      homeRootId: "__kb_root__",
      activeNodeId: null,
      activeInstanceKey: null,
      selectedNodeId: null,
      selectedInstanceKey: null,
      loadSource: null,
      loadError: null,
    });
    useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
  });

  it("planRemoveTag drops a sys.f.type ref", () => {
    const plan = planRemoveTag(useOutlineStore.getState().wireNodes, "n.root-a", "tag.todo");
    expect(plan.actions[0]?.input).toMatchObject({
      id: "n.root-a",
      unsetProps: [{ field: "sys.f.type", value: { t: "ref", v: "tag.todo" } }],
    });
  });

  it("planAddTagField appends template field on tag node", () => {
    const plan = planAddTagField(useOutlineStore.getState().wireNodes, "tag.todo", "field.status");
    const upsert = plan.upserts.find((n) => n.id === "tag.todo");
    expect(upsert?.props["sys.f.fields"]?.some((v) => v.v === "field.status")).toBe(true);
  });

  it("planSetTagColor writes sys.f.color on tag node", () => {
    const plan = planSetTagColor(useOutlineStore.getState().wireNodes, "tag.todo", "#3b82f6");
    const upsert = plan.upserts.find((n) => n.id === "tag.todo");
    expect(upsert?.props["sys.f.color"]).toEqual([{ t: "str", v: "#3b82f6" }]);
  });
});
