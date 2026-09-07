/**
 * Table columns and the multi-key sort, per rule.
 *
 * `view-config.test.ts` pins the happy paths — display refs win, tag fields
 * fill in, a numeric sort orders and does not mutate. What it does not pin is
 * the rest of the decision surface both functions carried inline: the
 * precedence when a named column is hidden, which fields derivation skips, and
 * the ordering of every value type plus a missing value under each direction.
 *
 * Written before `explicitColumns` / `derivedColumns` / `compareByField`,
 * unchanged through them.
 */
import { describe, expect, it } from "vitest";
import { stubOutlineNode } from "@/catalog/fixtures";
import { SYSTEM_IDS, type NodeMap, type OutlineNode, type PropValue } from "@/lib/types";
import {
  DEFAULT_VIEW_CONFIG,
  resolveTableColumns,
  sortChildrenForTable,
  type SortSpec,
} from "./view-config";

function field(id: string, text: string, hidden = false): OutlineNode {
  return stubOutlineNode({
    id,
    text,
    props: hidden ? { [SYSTEM_IDS.hiddenField]: [{ t: "bool", v: true }] } : {},
  });
}

/** A tag node templating the given field ids. */
function tagNode(id: string, fieldIds: string[]): OutlineNode {
  return stubOutlineNode({
    id,
    text: id,
    props: { [SYSTEM_IDS.fieldsField]: fieldIds.map((v) => ({ t: "ref" as const, v })) },
  });
}

function row(id: string, tagIds: string[], props: Record<string, PropValue[]> = {}): OutlineNode {
  return stubOutlineNode({
    id,
    text: id,
    props,
    tags: tagIds.map((tid) => ({ id: tid, name: tid, color: "" })),
  });
}

const nodes: NodeMap = new Map(
  [
    field("f.status", "status"),
    field("f.due", "due"),
    field("f.secret", "secret", true),
    field(SYSTEM_IDS.hiddenField, "hidden"),
    tagNode("t.todo", ["f.status", "f.secret", SYSTEM_IDS.hiddenField]),
    tagNode("t.dated", ["f.due", "f.status"]),
  ].map((n) => [n.id, n] as const),
);

const columnIds = (cols: { fieldId: string }[]) => cols.map((c) => c.fieldId);

/** A sortable row carrying at most one value of the single sort field. */
function withVal(id: string, v: PropValue | null, text = id): OutlineNode {
  return stubOutlineNode({ id, text, props: v ? { "f.v": [v] } : {} });
}

describe("table columns", () => {
  it("naming columns on the frame replaces derivation outright", () => {
    const cols = resolveTableColumns(
      { ...DEFAULT_VIEW_CONFIG, display: ["f.due"] },
      [row("r1", ["t.todo"])],
      nodes,
    );
    expect(columnIds(cols)).toEqual(["f.due"]);
  });

  it("a named column is still dropped when the field says hidden", () => {
    const cols = resolveTableColumns(
      { ...DEFAULT_VIEW_CONFIG, display: ["f.status", "f.secret"] },
      [row("r1", ["t.todo"])],
      nodes,
    );
    expect(columnIds(cols)).toEqual(["f.status"]);
  });

  it("naming only hidden fields shows no columns — it does not fall back", () => {
    const cols = resolveTableColumns(
      { ...DEFAULT_VIEW_CONFIG, display: ["f.secret"] },
      [row("r1", ["t.todo"])],
      nodes,
    );
    expect(cols).toEqual([]);
  });

  it("a named sys field is kept: naming one is a choice", () => {
    const cols = resolveTableColumns(
      { ...DEFAULT_VIEW_CONFIG, display: [SYSTEM_IDS.hiddenField] },
      [row("r1", ["t.todo"])],
      nodes,
    );
    expect(columnIds(cols)).toEqual([SYSTEM_IDS.hiddenField]);
  });

  it("derivation skips sys fields and hidden fields both", () => {
    const cols = resolveTableColumns(DEFAULT_VIEW_CONFIG, [row("r1", ["t.todo"])], nodes);
    expect(columnIds(cols)).toEqual(["f.status"]);
  });

  it("derivation walks every row's tags once, in first-seen order", () => {
    const cols = resolveTableColumns(
      DEFAULT_VIEW_CONFIG,
      [row("r1", ["t.dated"]), row("r2", ["t.todo"])],
      nodes,
    );
    expect(columnIds(cols)).toEqual(["f.due", "f.status"]);
  });

  it("an unresolvable tag contributes nothing", () => {
    const cols = resolveTableColumns(DEFAULT_VIEW_CONFIG, [row("r1", ["t.gone"])], nodes);
    expect(cols).toEqual([]);
  });

  it("debug columns keep the sys and hidden fields the normal pass drops", () => {
    const cols = resolveTableColumns(DEFAULT_VIEW_CONFIG, [row("r1", ["t.todo"])], nodes, true);
    expect(columnIds(cols)).toEqual(["f.status", "f.secret", SYSTEM_IDS.hiddenField]);
  });

  it("a column label falls back to the field id when the field has no text", () => {
    const cols = resolveTableColumns({ ...DEFAULT_VIEW_CONFIG, display: ["f.nowhere"] }, [], nodes);
    expect(cols).toEqual([{ fieldId: "f.nowhere", label: "f.nowhere" }]);
  });
});

describe("the multi-key sort", () => {
  const sortIds = (children: OutlineNode[], specs: SortSpec[]) =>
    sortChildrenForTable(children, specs, nodes).map((n) => n.id);

  it("no specs is the identity, same array order", () => {
    const children = [withVal("b", null), withVal("a", null)];
    expect(sortIds(children, [])).toEqual(["b", "a"]);
  });

  it("__name__ orders case-insensitively by node text", () => {
    const children = [withVal("x", null, "banana"), withVal("y", null, "Apple")];
    expect(sortIds(children, [{ fieldId: "__name__", dir: "asc" }])).toEqual(["y", "x"]);
    expect(sortIds(children, [{ fieldId: "__name__", dir: "desc" }])).toEqual(["x", "y"]);
  });

  it("numbers order numerically, not lexically", () => {
    const children = [
      withVal("a", { t: "num", v: 9 }),
      withVal("b", { t: "num", v: 10 }),
      withVal("c", { t: "num", v: -1 }),
    ];
    expect(sortIds(children, [{ fieldId: "f.v", dir: "asc" }])).toEqual(["c", "a", "b"]);
  });

  it("bools order false before true", () => {
    const children = [withVal("a", { t: "bool", v: true }), withVal("b", { t: "bool", v: false })];
    expect(sortIds(children, [{ fieldId: "f.v", dir: "asc" }])).toEqual(["b", "a"]);
  });

  it("refs order by their target's text, not by id", () => {
    const graph: NodeMap = new Map(nodes);
    graph.set("n.z", stubOutlineNode({ id: "n.z", text: "Alpha" }));
    graph.set("n.a", stubOutlineNode({ id: "n.a", text: "Zulu" }));
    const children = [withVal("r1", { t: "ref", v: "n.a" }), withVal("r2", { t: "ref", v: "n.z" })];
    expect(
      sortChildrenForTable(children, [{ fieldId: "f.v", dir: "asc" }], graph).map((n) => n.id),
    ).toEqual(["r2", "r1"]);
  });

  it("an unresolved ref orders by its raw id", () => {
    const children = [
      withVal("r1", { t: "ref", v: "n.zzz" }),
      withVal("r2", { t: "ref", v: "n.aaa" }),
    ];
    expect(sortIds(children, [{ fieldId: "f.v", dir: "asc" }])).toEqual(["r2", "r1"]);
  });

  it("strings and dates order case-insensitively as strings", () => {
    const children = [
      withVal("a", { t: "str", v: "2026-03-01" }),
      withVal("b", { t: "date", v: "2026-01-01" }),
    ];
    expect(sortIds(children, [{ fieldId: "f.v", dir: "asc" }])).toEqual(["b", "a"]);
  });

  it("mixed value types fall back to their string forms", () => {
    const children = [withVal("a", { t: "num", v: 9 }), withVal("b", { t: "str", v: "10" })];
    // "10" < "9" as strings — the mixed-type path is lexical on purpose.
    expect(sortIds(children, [{ fieldId: "f.v", dir: "asc" }])).toEqual(["b", "a"]);
  });

  it("a missing value sorts last ascending, and first descending", () => {
    const children = [withVal("a", null), withVal("b", { t: "str", v: "x" })];
    expect(sortIds(children, [{ fieldId: "f.v", dir: "asc" }])).toEqual(["b", "a"]);
    expect(sortIds(children, [{ fieldId: "f.v", dir: "desc" }])).toEqual(["a", "b"]);
  });

  it("two missing values are equal, so the next key decides", () => {
    const children = [
      stubOutlineNode({ id: "a", text: "beta" }),
      stubOutlineNode({ id: "b", text: "alpha" }),
    ];
    expect(
      sortIds(children, [
        { fieldId: "f.v", dir: "asc" },
        { fieldId: "__name__", dir: "asc" },
      ]),
    ).toEqual(["b", "a"]);
  });

  it("only the first value of a multi-valued prop is compared", () => {
    const children = [
      stubOutlineNode({
        id: "a",
        text: "a",
        props: {
          "f.v": [
            { t: "num", v: 5 },
            { t: "num", v: 1 },
          ],
        },
      }),
      stubOutlineNode({ id: "b", text: "b", props: { "f.v": [{ t: "num", v: 3 }] } }),
    ];
    expect(sortIds(children, [{ fieldId: "f.v", dir: "asc" }])).toEqual(["b", "a"]);
  });

  it("each key inverts on its own direction", () => {
    const children = [
      stubOutlineNode({ id: "a", text: "b", props: { "f.v": [{ t: "num", v: 1 }] } }),
      stubOutlineNode({ id: "b", text: "a", props: { "f.v": [{ t: "num", v: 1 }] } }),
    ];
    expect(
      sortIds(children, [
        { fieldId: "f.v", dir: "desc" },
        { fieldId: "__name__", dir: "desc" },
      ]),
    ).toEqual(["a", "b"]);
  });
});
