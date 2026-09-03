import { describe, expect, it } from "vitest";
import { SYSTEM_IDS } from "./types";
import type { NodeMap, OutlineNode } from "./types";
import {
  applyViewFilters,
  DEFAULT_VIEW_CONFIG,
  getViewConfig,
  groupChildrenForBoard,
  parseViewFilterEdn,
  resolveTableColumns,
  serializeViewFilter,
  sortChildrenForTable,
} from "./view-config";

describe("view-config", () => {
  it("returns default view config when props are empty or undefined", () => {
    expect(getViewConfig(undefined)).toEqual(DEFAULT_VIEW_CONFIG);
    expect(getViewConfig({})).toEqual(DEFAULT_VIEW_CONFIG);
    expect(DEFAULT_VIEW_CONFIG.groupFieldId).toBeNull();
    expect(DEFAULT_VIEW_CONFIG.filters).toEqual([]);
  });

  it("reads view mode (list|table|board|cards) and falls back to list on invalid mode", () => {
    expect(
      getViewConfig({
        [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "table" }],
      }).mode,
    ).toBe("table");
    expect(
      getViewConfig({
        [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "board" }],
      }).mode,
    ).toBe("board");
    expect(
      getViewConfig({
        [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "cards" }],
      }).mode,
    ).toBe("cards");
    expect(
      getViewConfig({
        [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "kanban" }],
      }).mode,
    ).toBe("list");
  });

  it("pairs sort refs and sort dirs correctly", () => {
    const config = getViewConfig({
      [SYSTEM_IDS.viewSortField]: [
        { t: "ref", v: "field1" },
        { t: "ref", v: "field2" },
      ],
      [SYSTEM_IDS.viewSortDirField]: [
        { t: "str", v: "desc" },
        // field2 has no dir -> default asc
      ],
    });

    expect(config.sort).toEqual([
      { fieldId: "field1", dir: "desc" },
      { fieldId: "field2", dir: "asc" },
    ]);
  });

  it("reads display refs, colwidth JSON, and pagesize", () => {
    const config = getViewConfig({
      [SYSTEM_IDS.viewDisplayField]: [
        { t: "ref", v: "f1" },
        { t: "ref", v: "f2" },
      ],
      [SYSTEM_IDS.viewColwidthField]: [
        { t: "str", v: JSON.stringify({ f1: 200, f2: 150 }) },
      ],
      [SYSTEM_IDS.viewPagesizeField]: [{ t: "num", v: 50 }],
    });

    expect(config.display).toEqual(["f1", "f2"]);
    expect(config.colwidth).toEqual({ f1: 200, f2: 150 });
    expect(config.pagesize).toBe(50);
  });

  it("handles colwidth JSON parse errors gracefully", () => {
    const config = getViewConfig({
      [SYSTEM_IDS.viewColwidthField]: [{ t: "str", v: "{bad json" }],
    });
    expect(config.colwidth).toEqual({});
  });

  it("sanitizes colwidth to finite numbers > 0 (drops arrays/strings/null/≤0)", () => {
    const config = getViewConfig({
      [SYSTEM_IDS.viewColwidthField]: [
        {
          t: "str",
          v: JSON.stringify({
            ok: 180,
            zero: 0,
            neg: -10,
            str: "200",
            nil: null,
            nan: Number.NaN,
          }),
        },
      ],
    });
    expect(config.colwidth).toEqual({ ok: 180 });

    const arr = getViewConfig({
      [SYSTEM_IDS.viewColwidthField]: [{ t: "str", v: JSON.stringify([1, 2]) }],
    });
    expect(arr.colwidth).toEqual({});
  });

  it("resolves columns from display refs or tag field fallback", () => {
    const nodes: NodeMap = new Map();
    nodes.set("tag1", {
      id: "tag1",
      text: "todo",
      parentId: null,
      children: [],
      collapsed: false,
      props: {
        [SYSTEM_IDS.fieldsField]: [
          { t: "ref", v: "f_status" },
          { t: "ref", v: "f_due" },
        ],
      },
      createdAt: "",
      updatedAt: "",
      tags: [],
    });
    nodes.set("f_status", {
      id: "f_status",
      text: "status",
      parentId: null,
      children: [],
      collapsed: false,
      props: {},
      createdAt: "",
      updatedAt: "",
      tags: [],
    });
    nodes.set("f_due", {
      id: "f_due",
      text: "due",
      parentId: null,
      children: [],
      collapsed: false,
      props: {},
      createdAt: "",
      updatedAt: "",
      tags: [],
    });

    const childNode: OutlineNode = {
      id: "c1",
      text: "Task 1",
      parentId: null,
      children: [],
      collapsed: false,
      props: {},
      createdAt: "",
      updatedAt: "",
      tags: [{ id: "tag1", name: "todo", color: "#fff" }],
    };

    // Case 1: display refs present
    const colsDisplay = resolveTableColumns(
      { ...DEFAULT_VIEW_CONFIG, display: ["f_status"] },
      [childNode],
      nodes,
    );
    expect(colsDisplay).toEqual([{ fieldId: "f_status", label: "status" }]);

    // Case 2: fallback to tag fields
    const colsFallback = resolveTableColumns(
      DEFAULT_VIEW_CONFIG,
      [childNode],
      nodes,
    );
    expect(colsFallback).toEqual([
      { fieldId: "f_status", label: "status" },
      { fieldId: "f_due", label: "due" },
    ]);
  });

  it("sorts children for table render projection without mutating original children array", () => {
    const nodes: NodeMap = new Map();
    const c1: OutlineNode = {
      id: "c1",
      text: "Banana",
      parentId: null,
      children: [],
      collapsed: false,
      props: { f_val: [{ t: "num", v: 20 }] },
      createdAt: "",
      updatedAt: "",
      tags: [],
    };
    const c2: OutlineNode = {
      id: "c2",
      text: "Apple",
      parentId: null,
      children: [],
      collapsed: false,
      props: { f_val: [{ t: "num", v: 10 }] },
      createdAt: "",
      updatedAt: "",
      tags: [],
    };

    const originalChildren = [c1, c2];

    // Sort by name asc
    const sortedByName = sortChildrenForTable(
      originalChildren,
      [{ fieldId: "__name__", dir: "asc" }],
      nodes,
    );
    expect(sortedByName.map((n) => n.id)).toEqual(["c2", "c1"]);

    // Sort by f_val desc
    const sortedByValDesc = sortChildrenForTable(
      originalChildren,
      [{ fieldId: "f_val", dir: "desc" }],
      nodes,
    );
    expect(sortedByValDesc.map((n) => n.id)).toEqual(["c1", "c2"]);

    // INVARIANT CHECK: Original array is untouched
    expect(originalChildren.map((n) => n.id)).toEqual(["c1", "c2"]);
  });

  it("parses filter EDN (good) and ignores bad EDN", () => {
    const eq = parseViewFilterEdn('{:field field.status :eq "doing"}');
    expect(eq).toEqual({
      kind: "eq",
      fieldId: "field.status",
      value: "doing",
      raw: '{:field field.status :eq "doing"}',
    });
    const text = parseViewFilterEdn('{:text "ship"}');
    expect(text).toEqual({
      kind: "text",
      text: "ship",
      raw: '{:text "ship"}',
    });
    expect(parseViewFilterEdn("{:bogus}")).toBeNull();
    expect(parseViewFilterEdn("not edn")).toBeNull();
    expect(
      serializeViewFilter({
        kind: "eq",
        fieldId: "f",
        value: "x",
        raw: "",
      }),
    ).toBe('{:field f :eq "x"}');
  });

  it("getViewConfig collects filters and group field; warns on bad EDN", () => {
    const warn = console.warn;
    const warns: string[] = [];
    console.warn = (...args: unknown[]) => {
      warns.push(String(args[0]));
    };
    try {
      const config = getViewConfig({
        [SYSTEM_IDS.viewGroupField]: [{ t: "ref", v: "field.status" }],
        [SYSTEM_IDS.viewFilterField]: [
          { t: "str", v: '{:field field.status :eq "doing"}' },
          { t: "str", v: "{bad" },
          { t: "str", v: '{:text "kb"}' },
        ],
      });
      expect(config.groupFieldId).toBe("field.status");
      expect(config.filters).toHaveLength(2);
      expect(config.filters[0]?.kind).toBe("eq");
      expect(config.filters[1]?.kind).toBe("text");
      expect(warns.some((w) => w.includes("bad filter"))).toBe(true);
    } finally {
      console.warn = warn;
    }
  });

  it("applyViewFilters ANDs eq + text filters", () => {
    const nodes: NodeMap = new Map();
    const a: OutlineNode = {
      id: "a",
      text: "Ship kb",
      parentId: null,
      children: [],
      collapsed: false,
      props: { "field.status": [{ t: "str", v: "doing" }] },
      createdAt: "",
      updatedAt: "",
      tags: [],
    };
    const b: OutlineNode = {
      id: "b",
      text: "Other",
      parentId: null,
      children: [],
      collapsed: false,
      props: { "field.status": [{ t: "str", v: "todo" }] },
      createdAt: "",
      updatedAt: "",
      tags: [],
    };
    const filtered = applyViewFilters(
      [a, b],
      [
        {
          kind: "eq",
          fieldId: "field.status",
          value: "doing",
          raw: "",
        },
        { kind: "text", text: "ship", raw: "" },
      ],
      nodes,
    );
    expect(filtered.map((n) => n.id)).toEqual(["a"]);
  });

  it("groupChildrenForBoard groups by field + empty column; cards = single column", () => {
    const nodes: NodeMap = new Map();
    nodes.set("field.status", {
      id: "field.status",
      text: "status",
      parentId: null,
      children: [],
      collapsed: false,
      props: {},
      createdAt: "",
      updatedAt: "",
      tags: [],
    });
    const doing: OutlineNode = {
      id: "d",
      text: "Doing",
      parentId: null,
      children: [],
      collapsed: false,
      props: { "field.status": [{ t: "str", v: "doing" }] },
      createdAt: "",
      updatedAt: "",
      tags: [],
    };
    const empty: OutlineNode = {
      id: "e",
      text: "Empty",
      parentId: null,
      children: [],
      collapsed: false,
      props: {},
      createdAt: "",
      updatedAt: "",
      tags: [],
    };
    const cols = groupChildrenForBoard([doing, empty], "field.status", nodes);
    expect(cols.map((c) => c.key)).toContain("__empty__");
    expect(cols.find((c) => c.label === "doing")?.nodes.map((n) => n.id)).toEqual([
      "d",
    ]);
    expect(cols.find((c) => c.key === "__empty__")?.nodes.map((n) => n.id)).toEqual([
      "e",
    ]);

    const cards = groupChildrenForBoard([doing, empty], null, nodes);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.nodes.map((n) => n.id)).toEqual(["d", "e"]);
  });
});
