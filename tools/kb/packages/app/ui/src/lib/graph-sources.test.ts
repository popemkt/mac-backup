/**
 * The graph option sets, resolved the way the picker resolves them.
 *
 * `lens.renderer` and the five source-selecting lens fields declare their
 * options as data — the renderer field by parenting them, the five source
 * fields by a `targetQuery` over the shared `sys.graph.sources` list narrowed
 * to one `kind` (DESIGN → Kinds, roles and options). Both used to be a
 * `targetTag` naming a supertag that templated nothing.
 *
 * Asserting the seed's *shape* would not be enough: a `targetQuery` that
 * returns no rows is a declaration no code path reads, which reads as covered
 * and is not. So these run the real engine over the real seed and assert the
 * rows, in the same binding the browser picker uses.
 */
import { describe, expect, it } from "vitest";
import { DatascriptIndex } from "@/ds";
import { parsePerspective } from "@/lib/graph-lens";
import {
  GRAPH_RENDERER_VALUES,
  GRAPH_SOURCE_VALUES,
  SYSTEM_IDS,
  allowedRefIdsOf,
  present,
  systemSeedNodes,
  type KbNode,
} from "@kb/model";
import type { WireNode } from "@kb/contracts";

const seed: KbNode[] = systemSeedNodes("2026-09-09T00:00:00.000Z");
const byId = new Map(seed.map((node) => [node.id, node]));
const index = new DatascriptIndex(seed);
const runner = (edn: string): unknown[][] => index.runDatalog(edn);

function allowed(fieldId: string): string[] {
  return [
    ...present(allowedRefIdsOf(byId.get(fieldId), byId, runner), `allowed refs of ${fieldId}`),
  ].toSorted();
}

function sourceIds(...keys: (keyof typeof GRAPH_SOURCE_VALUES)[]): string[] {
  return keys.map((key) => GRAPH_SOURCE_VALUES[key].id).toSorted();
}

describe("graph option sets resolve from data", () => {
  it("lens.renderer offers its own children — the five renderers", () => {
    expect(allowed(SYSTEM_IDS.lensRendererField)).toEqual(
      Object.values(GRAPH_RENDERER_VALUES)
        .map((value) => value.id)
        .toSorted(),
    );
  });

  it("each source field offers the shared list narrowed to its kind", () => {
    expect(allowed(SYSTEM_IDS.lensColorByField)).toEqual(sourceIds("tag", "parent", "none"));
    expect(allowed(SYSTEM_IDS.lensClusterByField)).toEqual(sourceIds("tag", "parent", "none"));
    expect(allowed(SYSTEM_IDS.lensSizeByField)).toEqual(sourceIds("degree", "children", "fixed"));
    expect(allowed(SYSTEM_IDS.lensLabelByField)).toEqual(sourceIds("text"));
    expect(allowed(SYSTEM_IDS.lensEdgeKindsField)).toEqual(
      sourceIds("child", "mention", "ref-prop"),
    );
  });

  it("the ten options are one list, and each carries its kind", () => {
    const list = present(byId.get(SYSTEM_IDS.graphSourcesRoot), "sys.graph.sources");
    expect(list.children).toEqual(Object.values(GRAPH_SOURCE_VALUES).map((value) => value.id));
    for (const value of Object.values(GRAPH_SOURCE_VALUES)) {
      const option = present(byId.get(value.id), value.id);
      expect(option.props[SYSTEM_IDS.graphSourceKindField], value.id).toBeDefined();
    }
  });
});

function perspective(props: WireNode["props"]): WireNode {
  return {
    id: "lens.custom",
    text: "Custom",
    props,
    children: [],
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  };
}

describe("stored values outside the option set", () => {
  it("reads a prop:<id> source the narrowed picker would not offer", () => {
    const parsed = parsePerspective(
      perspective({
        [SYSTEM_IDS.lensColorByField]: [{ t: "str", v: "prop:field.status" }],
        [SYSTEM_IDS.lensSizeByField]: [{ t: "str", v: "prop:field.weight" }],
        [SYSTEM_IDS.lensEdgeKindsField]: [{ t: "str", v: "prop:field.owner" }],
      }),
    );
    expect(parsed.colorBy).toBe("prop:field.status");
    expect(parsed.sizeBy).toBe("prop:field.weight");
    expect(parsed.edgeKinds).toEqual(["prop:field.owner"]);
  });

  it("reads the `none` edge-kinds sentinel back as no edge kinds", () => {
    const parsed = parsePerspective(
      perspective({
        [SYSTEM_IDS.lensEdgeKindsField]: [{ t: "ref", v: GRAPH_SOURCE_VALUES.none.id }],
      }),
    );
    expect(parsed.edgeKinds).toEqual([]);
  });
});
