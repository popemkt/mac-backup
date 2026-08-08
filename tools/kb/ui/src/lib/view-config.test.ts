import { describe, expect, it } from "vitest";
import { SYSTEM_IDS } from "./types";
import type { NodeMap, OutlineNode } from "./types";
import {
  DEFAULT_VIEW_CONFIG,
  getViewConfig,
  resolveTableColumns,
  sortChildrenForTable,
} from "./view-config";

describe("view-config", () => {
  it("returns default view config when props are empty or undefined", () => {
    expect(getViewConfig(undefined)).toEqual(DEFAULT_VIEW_CONFIG);
    expect(getViewConfig({})).toEqual(DEFAULT_VIEW_CONFIG);
  });

  it("reads view mode (list|table) and falls back to list on invalid mode", () => {
    expect(
      getViewConfig({
        [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "table" }],
      }).mode,
    ).toBe("table");

    expect(
      getViewConfig({
        [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "board" }],
      }).mode,
    ).toBe("list");

    expect(
      getViewConfig({
        [SYSTEM_IDS.viewModeField]: [{ t: "str", v: "cards" }],
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
});
