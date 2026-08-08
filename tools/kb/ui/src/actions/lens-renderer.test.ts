import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureGraph } from "@/fixtures/graph";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { planSetLensRenderer } from "@/actions/plan";

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
    cursorPosition: 0,
    loadSource: null,
    loadError: null,
  });
  useOutlineStore
    .getState()
    .hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
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
          s.field === SYSTEM_IDS.lensRendererField &&
          s.value.t === "str" &&
          s.value.v === "tree",
      ),
    ).toBe(true);
    const upserted = plan.upserts.find((n) => n.id === SYSTEM_IDS.lensAllMentions);
    expect(upserted?.props[SYSTEM_IDS.lensRendererField]).toEqual([
      { t: "str", v: "tree" },
    ]);
  });
});
