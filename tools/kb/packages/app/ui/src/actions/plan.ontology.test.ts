import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { SYSTEM_IDS } from "@/lib/types";
import {
  planDefineOntology,
  planOntologyAddExtends,
  planOntologyAddInclude,
  planOntologyExclude,
  planOntologySetQuery,
} from "./plan";

const node = (id: string, props: WireNode["props"] = {}): WireNode => ({
  id,
  text: id,
  props,
  children: [],
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
});

describe("ontology action inputs", () => {
  it("mints ontologies through node.add", () => {
    expect(planDefineOntology("Work", "onto.work").actions).toEqual([
      { id: "node.add", input: { id: "onto.work", text: "Work", tags: [SYSTEM_IDS.ontologyTag] } },
    ]);
  });

  it("uses ordinary ref-valued properties", () => {
    expect(planOntologyAddInclude([node("onto")], "onto", "tag.work").actions).toEqual([
      {
        id: "node.update",
        input: {
          id: "onto",
          setProps: [{ field: SYSTEM_IDS.ontoIncludeField, value: { t: "ref", v: "tag.work" } }],
        },
      },
    ]);
  });

  it("exclude also removes a contradictory explicit member", () => {
    const nodes = [node("onto", { [SYSTEM_IDS.ontoMemberField]: [{ t: "ref", v: "n.a" }] })];
    expect(planOntologyExclude(nodes, "onto", "n.a").actions).toHaveLength(2);
  });

  it("trims queries and rejects extends cycles before invoking", () => {
    const nodes = [node("a", { [SYSTEM_IDS.ontoExtendsField]: [{ t: "ref", v: "b" }] }), node("b")];
    expect(planOntologySetQuery(nodes, "a", "  [:find ?e]  ").actions[0]).toMatchObject({
      input: { setProps: [{ value: { t: "str", v: "[:find ?e]" } }] },
    });
    expect(planOntologyAddExtends(nodes, "b", "a")).toBeNull();
  });
});
