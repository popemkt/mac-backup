import { describe, expect, it } from "vitest";
import { buildQueryDb } from "@/ds/db";
import { fixtureGraph } from "@/fixtures/graph";
import { wireToOutlineMap } from "@/lib/graph-view";
import {
  emptyValueForType,
  isValueMismatch,
  resolveAllowedRefIds,
  resolveFieldType,
  resolveFieldTypeById,
} from "@/lib/field-type";
import { SYSTEM_IDS, type OutlineNode } from "@/lib/types";
import type { WireNode } from "@kb/protocol";
import {
  planAddFieldTargetTag,
  planSetFieldTargetQuery,
  planSetFieldType,
} from "@/actions/plan";

function outline(): Map<string, OutlineNode> {
  return wireToOutlineMap(fixtureGraph.nodes, new Set());
}

function fieldNode(
  partial: Partial<WireNode> & { id: string; text: string },
): WireNode {
  return {
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] },
    children: [],
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    ...partial,
  };
}

describe("field types", () => {
  it("defaults to text when sys.f.fieldType is absent", () => {
    const nodes = outline();
    expect(resolveFieldTypeById("field.status", nodes)).toBe("text");
    expect(resolveFieldType(undefined)).toBe("text");
  });

  it("selects editors by declared type (mismatch detection)", () => {
    expect(isValueMismatch("text", { t: "str", v: "x" })).toBe(false);
    expect(isValueMismatch("number", { t: "num", v: 1 })).toBe(false);
    expect(isValueMismatch("number", { t: "str", v: "1" })).toBe(true);
    expect(isValueMismatch("checkbox", { t: "bool", v: true })).toBe(false);
    expect(isValueMismatch("ref", { t: "ref", v: "n.root-a" })).toBe(false);
    expect(isValueMismatch("ref", { t: "str", v: "n.root-a" })).toBe(true);
    expect(isValueMismatch("date", { t: "str", v: "2026-08-08" })).toBe(false);
    expect(isValueMismatch("date", { t: "date", v: "2026-08-08" })).toBe(false);
    expect(isValueMismatch("url", { t: "str", v: "https://x" })).toBe(false);
    expect(emptyValueForType("checkbox")).toEqual({ t: "bool", v: false });
    expect(emptyValueForType("ref")).toEqual({ t: "ref", v: "" });
  });

  it("filters ref suggestions by targetTag union", () => {
    const wire = [
      ...fixtureGraph.nodes,
      fieldNode({
        id: "field.assignee",
        text: "assignee",
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
          [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "ref" }],
          [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: "tag.todo" }],
        },
      }),
    ];
    const nodes = wireToOutlineMap(wire, new Set());
    const field = nodes.get("field.assignee");
    const allowed = resolveAllowedRefIds(field, nodes, null);
    expect(allowed).not.toBeNull();
    expect([...allowed!].sort()).toEqual(["n.root-a", "n.root-b"]);
    expect(allowed!.has("n.root-c")).toBe(false);
  });

  it("filters ref suggestions by targetQuery result set", () => {
    const edn = `[:find ?id :where [?n :node/id ?id] [?n :node/text "Ship kb ui shell"]]`;
    const wire = [
      ...fixtureGraph.nodes,
      fieldNode({
        id: "field.pick",
        text: "pick",
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
          [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "ref" }],
          [SYSTEM_IDS.targetQueryField]: [{ t: "str", v: edn }],
        },
      }),
    ];
    const nodes = wireToOutlineMap(wire, new Set());
    const qdb = buildQueryDb(wire, 1);
    const allowed = resolveAllowedRefIds(nodes.get("field.pick"), nodes, qdb);
    expect([...allowed!]).toEqual(["n.root-a"]);
  });

  it("query wins over tag when both are set", () => {
    const edn = `[:find ?id :where [?n :node/id ?id] [?n :node/text "Read-only props panel resolves field names"]]`;
    const wire = [
      ...fixtureGraph.nodes,
      fieldNode({
        id: "field.both",
        text: "both",
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
          [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "ref" }],
          [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: "tag.todo" }],
          [SYSTEM_IDS.targetQueryField]: [{ t: "str", v: edn }],
        },
      }),
    ];
    const nodes = wireToOutlineMap(wire, new Set());
    const qdb = buildQueryDb(wire, 1);
    const allowed = resolveAllowedRefIds(nodes.get("field.both"), nodes, qdb);
    // Query matches n.root-c only; tag.todo would have included a/b — query wins.
    expect([...allowed!]).toEqual(["n.root-c"]);
  });

  it("plan helpers write fieldType / targetTag / targetQuery", () => {
    const wire = [
      ...fixtureGraph.nodes,
      fieldNode({ id: "field.x", text: "x" }),
    ];
    const typed = planSetFieldType(wire, "field.x", "ref");
    expect(typed.upserts[0]?.props[SYSTEM_IDS.fieldTypeField]).toEqual([
      { t: "str", v: "ref" },
    ]);

    const withType: WireNode[] = [
      ...wire.filter((n) => n.id !== "field.x"),
      {
        ...fieldNode({ id: "field.x", text: "x" }),
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
          [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "ref" }],
        },
      },
    ];
    const tagged = planAddFieldTargetTag(withType, "field.x", "tag.todo");
    expect(tagged.upserts[0]?.props[SYSTEM_IDS.targetTagField]).toEqual([
      { t: "ref", v: "tag.todo" },
    ]);

    const queried = planSetFieldTargetQuery(
      withType,
      "field.x",
      "[:find ?id :where [?e :node/id ?id]]",
    );
    expect(queried.upserts[0]?.props[SYSTEM_IDS.targetQueryField]).toEqual([
      { t: "str", v: "[:find ?id :where [?e :node/id ?id]]" },
    ]);
  });
});
