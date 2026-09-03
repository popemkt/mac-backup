import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import {
  planDefineOntology,
  planOntologyAddExtends,
  planOntologyAddInclude,
  planOntologyExclude,
  planOntologyRemoveExtends,
  planOntologySetClosure,
  planOntologySetQuery,
} from "@/actions/plan";
import { SYSTEM_IDS } from "@/lib/types";

const ISO = "2026-08-23T00:00:00.000Z";

function node(id: string, text: string, props: WireNode["props"] = {}): WireNode {
  return { id, text, props, children: [], createdAt: ISO, updatedAt: ISO };
}

function onto(id: string, props: WireNode["props"] = {}): WireNode {
  return node(id, id, {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
    ...props,
  });
}

function propsOf(plan: { upserts: WireNode[] }, id: string, field: string) {
  return plan.upserts.find((n) => n.id === id)?.props[field] ?? [];
}

describe("planDefineOntology", () => {
  it("mints a plain node tagged #ontology and focuses it for rename", () => {
    const plan = planDefineOntology("Infrastructure", "o.new");
    expect(plan.upserts).toHaveLength(1);
    expect(propsOf(plan, "o.new", SYSTEM_IDS.typeField)).toEqual([
      { t: "ref", v: SYSTEM_IDS.ontologyTag },
    ]);
    expect(plan.actions).toEqual([
      {
        id: "node.add",
        input: {
          text: "Infrastructure",
          id: "o.new",
          tags: [SYSTEM_IDS.ontologyTag],
        },
      },
    ]);
    expect(plan.focusId).toBe("o.new");
    expect(plan.focusCursor).toBe("Infrastructure".length);
  });
});

describe("planOntologyAddInclude", () => {
  it("appends a ref (multi-valued)", () => {
    const nodes = [onto("o", { [SYSTEM_IDS.ontoIncludeField]: [{ t: "ref", v: "t.a" }] })];
    const plan = planOntologyAddInclude(nodes, "o", "t.b");
    expect(propsOf(plan, "o", SYSTEM_IDS.ontoIncludeField)).toEqual([
      { t: "ref", v: "t.a" },
      { t: "ref", v: "t.b" },
    ]);
  });
});

describe("planOntologyExclude", () => {
  it("emits both the exclude-set and the member-unset in one plan", () => {
    const nodes = [onto("o", { [SYSTEM_IDS.ontoMemberField]: [{ t: "ref", v: "n.1" }] })];
    const plan = planOntologyExclude(nodes, "o", "n.1");
    expect(propsOf(plan, "o", SYSTEM_IDS.ontoExcludeField)).toEqual([{ t: "ref", v: "n.1" }]);
    expect(propsOf(plan, "o", SYSTEM_IDS.ontoMemberField)).toEqual([]);
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions[0]!.id).toBe("node.update");
    expect(plan.actions[1]!.id).toBe("node.update");
  });

  it("is a single action when the node was not pinned", () => {
    const plan = planOntologyExclude([onto("o")], "o", "n.1");
    expect(plan.actions).toHaveLength(1);
    expect(propsOf(plan, "o", SYSTEM_IDS.ontoExcludeField)).toEqual([{ t: "ref", v: "n.1" }]);
  });

  it("leaves an unrelated pin alone", () => {
    const nodes = [onto("o", { [SYSTEM_IDS.ontoMemberField]: [{ t: "ref", v: "n.2" }] })];
    const plan = planOntologyExclude(nodes, "o", "n.1");
    expect(propsOf(plan, "o", SYSTEM_IDS.ontoMemberField)).toEqual([{ t: "ref", v: "n.2" }]);
  });
});

describe("planOntologyAddExtends", () => {
  const nodes = [
    onto("o.a", { [SYSTEM_IDS.ontoExtendsField]: [{ t: "ref", v: "o.b" }] }),
    onto("o.b"),
    onto("o.c"),
  ];

  it("returns null on a self edge", () => {
    expect(planOntologyAddExtends(nodes, "o.a", "o.a")).toBeNull();
  });

  it("returns null when the edge would close a cycle", () => {
    expect(planOntologyAddExtends(nodes, "o.b", "o.a")).toBeNull();
  });

  it("plans the ref for an acyclic edge", () => {
    const plan = planOntologyAddExtends(nodes, "o.a", "o.c");
    expect(plan).not.toBeNull();
    expect(propsOf(plan!, "o.a", SYSTEM_IDS.ontoExtendsField)).toEqual([
      { t: "ref", v: "o.b" },
      { t: "ref", v: "o.c" },
    ]);
  });

  it("removes only the named parent", () => {
    const plan = planOntologyRemoveExtends(nodes, "o.a", "o.b");
    expect(propsOf(plan, "o.a", SYSTEM_IDS.ontoExtendsField)).toEqual([]);
  });
});

describe("planOntologySetQuery", () => {
  const edn = "[:find ?id :where [?n :node/id ?id]]";

  it("replaces the previous single value rather than appending", () => {
    const nodes = [onto("o", { [SYSTEM_IDS.ontoQueryField]: [{ t: "str", v: "old" }] })];
    const plan = planOntologySetQuery(nodes, "o", edn);
    expect(propsOf(plan, "o", SYSTEM_IDS.ontoQueryField)).toEqual([{ t: "str", v: edn }]);
    const input = plan.actions[0]!.input as {
      unsetProps?: unknown[];
      setProps?: unknown[];
    };
    expect(input.unsetProps).toEqual([
      { field: SYSTEM_IDS.ontoQueryField, value: { t: "str", v: "old" } },
    ]);
  });

  it("clears the field when the query is blanked", () => {
    const nodes = [onto("o", { [SYSTEM_IDS.ontoQueryField]: [{ t: "str", v: "old" }] })];
    const plan = planOntologySetQuery(nodes, "o", "   ");
    expect(propsOf(plan, "o", SYSTEM_IDS.ontoQueryField)).toEqual([]);
  });
});

describe("planOntologySetClosure", () => {
  it("sets descendants and clears back to none", () => {
    const set = planOntologySetClosure([onto("o")], "o", "descendants");
    expect(propsOf(set, "o", SYSTEM_IDS.ontoClosureField)).toEqual([
      { t: "str", v: "descendants" },
    ]);

    const nodes = [
      onto("o", {
        [SYSTEM_IDS.ontoClosureField]: [{ t: "str", v: "descendants" }],
      }),
    ];
    const cleared = planOntologySetClosure(nodes, "o", "none");
    expect(propsOf(cleared, "o", SYSTEM_IDS.ontoClosureField)).toEqual([]);
  });
});
