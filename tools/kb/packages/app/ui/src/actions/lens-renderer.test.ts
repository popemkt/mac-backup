import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureGraph } from "@/fixtures/graph";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { planSetLensProp, planSetLensRenderer } from "@/actions/plan";

vi.mock("@/api/action", () => ({
  postAction: vi.fn(async () => ({ status: "ok", message: "", output: {} })),
}));

function seed() {
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
    loadSource: null,
    loadError: null,
  });
  useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
}

describe("planSetLensRenderer", () => {
  beforeEach(() => seed());

  it("persists sys.f.lens.renderer via unset+set", () => {
    const wire = useOutlineStore.getState().wireNodes;
    const plan = planSetLensRenderer(wire, SYSTEM_IDS.lensAllMentions, "tree");
    const action = plan.actions[0] as {
      input: {
        id: string;
        setProps?: Array<{ field: string; value: { t: string; v: string } }>;
        unsetProps?: Array<{ field: string }>;
      };
    };
    expect(action.input.id).toBe(SYSTEM_IDS.lensAllMentions);
    expect(action.input.unsetProps?.some((u) => u.field === SYSTEM_IDS.lensRendererField)).toBe(
      true,
    );
    expect(
      action.input.setProps?.some(
        (s) =>
          s.field === SYSTEM_IDS.lensRendererField && s.value.t === "str" && s.value.v === "tree",
      ),
    ).toBe(true);
    const upserted = plan.upserts.find((n) => n.id === SYSTEM_IDS.lensAllMentions);
    expect(upserted?.props[SYSTEM_IDS.lensRendererField]).toEqual([{ t: "str", v: "tree" }]);
  });
});

describe("planSetLensProp", () => {
  beforeEach(() => seed());

  it("unsets the whole field before set so a second write leaves exactly one value", () => {
    const wire = useOutlineStore.getState().wireNodes;
    // Simulate a corrupted multi-valued renderer prop (CLI append).
    const corrupt = wire.map((n) =>
      n.id === SYSTEM_IDS.lensAllMentions
        ? {
            ...n,
            props: {
              ...n.props,
              [SYSTEM_IDS.lensRendererField]: [
                { t: "str" as const, v: "force2d" },
                { t: "str" as const, v: "force3d" },
              ],
            },
          }
        : n,
    );
    const once = planSetLensProp(
      corrupt,
      SYSTEM_IDS.lensAllMentions,
      SYSTEM_IDS.lensClusterByField,
      { t: "str", v: "parent" },
    );
    expect(once.upserts[0]?.props[SYSTEM_IDS.lensClusterByField]).toEqual([
      { t: "str", v: "parent" },
    ]);

    const twice = planSetLensProp(
      once.upserts,
      SYSTEM_IDS.lensAllMentions,
      SYSTEM_IDS.lensClusterByField,
      { t: "str", v: "none" },
    );
    expect(twice.upserts[0]?.props[SYSTEM_IDS.lensClusterByField]).toEqual([
      { t: "str", v: "none" },
    ]);
    expect((twice.actions[0] as { input: { unsetProps?: unknown[] } }).input.unsetProps).toEqual([
      { field: SYSTEM_IDS.lensClusterByField },
    ]);

    const fixRenderer = planSetLensProp(
      corrupt,
      SYSTEM_IDS.lensAllMentions,
      SYSTEM_IDS.lensRendererField,
      { t: "str", v: "force2d" },
    );
    expect(fixRenderer.upserts[0]?.props[SYSTEM_IDS.lensRendererField]).toEqual([
      { t: "str", v: "force2d" },
    ]);
  });
});
