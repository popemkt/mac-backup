import { describe, expect, it } from "vitest";
import { fieldTypeValue } from "@/lib/field-type";
import { fieldContextOf } from "@/lib/schema";
import { refCreationOf, refUses } from "@/lib/refs";
import { SYSTEM_IDS, type NodeMap } from "@/lib/types";
import { stubOutlineNode } from "@/catalog/fixtures";

const ref = { [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")] };
const nodes: NodeMap = new Map([
  ["f.opts", stubOutlineNode({ id: "f.opts", text: "status", children: ["o.1"], props: ref })],
  [
    "f.tagged",
    stubOutlineNode({
      id: "f.tagged",
      text: "owner",
      props: { ...ref, [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: "t.person" }] },
    }),
  ],
  [
    "f.query",
    stubOutlineNode({
      id: "f.query",
      text: "q",
      props: {
        ...ref,
        [SYSTEM_IDS.targetQueryField]: [{ t: "str", v: "[:find ?id :where [?n :node/id ?id]]" }],
      },
    }),
  ],
  ["f.open", stubOutlineNode({ id: "f.open", text: "link", props: ref })],
  ["n.a", stubOutlineNode({ id: "n.a", text: "a", props: { "f.open": [{ t: "ref", v: "x" }] } })],
  [
    "n.b",
    stubOutlineNode({
      id: "n.b",
      text: "b",
      props: {
        "f.open": [
          { t: "ref", v: "x" },
          { t: "ref", v: "y" },
        ],
      },
    }),
  ],
]);
const context = fieldContextOf({ ontologyId: null, nodes, wireNodes: [], index: null });

describe("where a picker mints a new target", () => {
  it("an option goes under its field; a tagged field's target carries the tag", () => {
    expect(refCreationOf(context, "f.opts")).toEqual({ kind: "child", parentId: "f.opts" });
    expect(refCreationOf(context, "f.tagged")).toEqual({ kind: "tagged", tagId: "t.person" });
    expect(refCreationOf(context, "f.open")).toEqual({ kind: "root" });
  });

  it("a query-constrained field mints nothing: its members cannot be promised", () => {
    expect(refCreationOf(context, "f.query")).toBeNull();
  });
});

describe("how much a value is used", () => {
  it("counts the nodes that hold each value of a field", () => {
    expect(refUses(nodes, "f.open")).toEqual(
      new Map([
        ["x", 2],
        ["y", 1],
      ]),
    );
  });
});
