/**
 * The malformed-config-prop policy, for both node-backed configs.
 *
 * An absent prop is *unset*: the slot's declared default applies and nothing
 * is said. A prop that is present and unreadable is *malformed*: the default
 * applies and the decode reports which field it ignored and why, through the
 * ui log seam (`lib/log`), because a bad prop must never make a view
 * unopenable. See `@kb/model`'s `node-config` for the mechanism and
 * `DESIGN.md` → "Domain typing" for the rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WireNode } from "@kb/contracts";
import { parsePerspective } from "@/lib/graph-lens";
import { getViewConfig } from "@/lib/view-config";
import { SYSTEM_IDS, type PropValue } from "@/lib/types";

let warned: string[] = [];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warned = [];
  spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warned.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  spy.mockRestore();
});

function perspective(props: Record<string, PropValue[]>): WireNode {
  return {
    id: "lens.p",
    text: "P",
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.graphPerspectiveTag }], ...props },
    children: [],
    createdAt: "2026-08-08T05:00:00.000Z",
    updatedAt: "2026-08-08T05:00:00.000Z",
  };
}

describe("parsePerspective reporting", () => {
  it("says nothing about a perspective that carries no lens props", () => {
    parsePerspective(perspective({}));
    expect(warned).toEqual([]);
  });

  it("names the node and the field when a lens prop is not a legal value", () => {
    const parsed = parsePerspective(
      perspective({ [SYSTEM_IDS.lensLayoutField]: [{ t: "str", v: "circular" }] }),
    );
    expect(parsed.layout).toBe("force");
    expect(warned).toEqual([
      `[graph-lens] lens.p: ${SYSTEM_IDS.lensLayoutField} ignored: Expected "force" | "radial" | "hierarchical" | "grid"`,
    ]);
  });

  it("reports a prop stored under a carrier the slot cannot read", () => {
    const parsed = parsePerspective(
      perspective({ [SYSTEM_IDS.lensShowLabelsField]: [{ t: "str", v: "false" }] }),
    );
    expect(parsed.showLabels).toBe(true);
    expect(warned).toEqual([
      `[graph-lens] lens.p: ${SYSTEM_IDS.lensShowLabelsField} ignored: no readable value`,
    ]);
  });

  it("reports a max-nodes that is not a count, and keeps the default", () => {
    const parsed = parsePerspective(
      perspective({ [SYSTEM_IDS.lensMaxNodesField]: [{ t: "num", v: -5 }] }),
    );
    expect(parsed.maxNodes).toBe(500);
    expect(warned).toEqual([
      `[graph-lens] lens.p: ${SYSTEM_IDS.lensMaxNodesField} ignored: Expected a value greater than 0`,
    ]);
  });

  it("reports one edge kind by index and keeps the others", () => {
    const parsed = parsePerspective(
      perspective({
        [SYSTEM_IDS.lensEdgeKindsField]: [
          { t: "str", v: "mention" },
          { t: "str", v: "bogus" },
          { t: "str", v: "child" },
        ],
      }),
    );
    expect(parsed.edgeKinds).toEqual(["mention", "child"]);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(`${SYSTEM_IDS.lensEdgeKindsField}[1] ignored`);
  });

  it("says nothing about the `none` edge-kinds sentinel", () => {
    const parsed = parsePerspective(
      perspective({
        [SYSTEM_IDS.lensEdgeKindsField]: [{ t: "ref", v: "sys.graph.source.none" }],
      }),
    );
    expect(parsed.edgeKinds).toEqual([]);
    expect(warned).toEqual([]);
  });
});

describe("getViewConfig reporting", () => {
  it("says nothing about a frame that carries no view props", () => {
    getViewConfig({});
    getViewConfig(undefined);
    expect(warned).toEqual([]);
  });

  it("reports an unknown view mode", () => {
    expect(getViewConfig({ [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "kanban" }] }).mode).toBe(
      "list",
    );
    expect(warned).toEqual([
      `[view-config] ${SYSTEM_IDS.viewModeField} ignored: Expected "list" | "table" | "board" | "cards"`,
    ]);
  });

  it("reports a colwidth map holding anything that is not a width", () => {
    expect(
      getViewConfig({
        [SYSTEM_IDS.viewColwidthField]: [{ t: "str", v: JSON.stringify({ ok: 180, bad: 0 }) }],
      }).colwidth,
    ).toEqual({});
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(`${SYSTEM_IDS.viewColwidthField} ignored`);
  });

  it("reports a bad filter clause by index and keeps the readable ones", () => {
    const config = getViewConfig({
      [SYSTEM_IDS.viewFilterField]: [
        { t: "str", v: '{:text "kb"}' },
        { t: "str", v: "{bad" },
      ],
    });
    expect(config.filters).toHaveLength(1);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(`${SYSTEM_IDS.viewFilterField}[1] ignored`);
  });

  it("names both sort fields when a stored direction is not a direction", () => {
    const config = getViewConfig({
      [SYSTEM_IDS.viewSortField]: [
        { t: "ref", v: "f1" },
        { t: "ref", v: "f2" },
      ],
      [SYSTEM_IDS.viewSortDirField]: [
        { t: "str", v: "sideways" },
        { t: "str", v: "desc" },
      ],
    });
    expect(config.sort).toEqual([{ fieldId: "f2", dir: "desc" }]);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(
      `${SYSTEM_IDS.viewSortField} + ${SYSTEM_IDS.viewSortDirField}[0] ignored`,
    );
  });

  it("treats an absent direction as unset rather than malformed", () => {
    const config = getViewConfig({
      [SYSTEM_IDS.viewSortField]: [{ t: "ref", v: "f1" }],
    });
    expect(config.sort).toEqual([{ fieldId: "f1", dir: "asc" }]);
    expect(warned).toEqual([]);
  });

  it("reports a display column that is not a field reference, and keeps a repeat silent", () => {
    const config = getViewConfig({
      [SYSTEM_IDS.viewDisplayField]: [
        { t: "ref", v: "f1" },
        { t: "str", v: "f2" },
        { t: "ref", v: "f1" },
      ],
    });
    expect(config.display).toEqual(["f1"]);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(`${SYSTEM_IDS.viewDisplayField}[1] ignored`);
  });

  it("reports a sort key that is not a field reference", () => {
    const config = getViewConfig({
      [SYSTEM_IDS.viewSortField]: [
        { t: "str", v: "f1" },
        { t: "ref", v: "f2" },
      ],
    });
    expect(config.sort).toEqual([{ fieldId: "f2", dir: "asc" }]);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(
      `${SYSTEM_IDS.viewSortField} + ${SYSTEM_IDS.viewSortDirField}[0] ignored`,
    );
  });

  it("reports an empty group-by reference, since an id is never the empty string", () => {
    expect(getViewConfig({ [SYSTEM_IDS.viewGroupField]: [{ t: "ref", v: "" }] }).groupFieldId).toBe(
      null,
    );
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(`${SYSTEM_IDS.viewGroupField} ignored`);
  });
});
