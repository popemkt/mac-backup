/**
 * Which fields can type a relation to a target (`relationFieldFit`), and what
 * a picker offers for it (`relationFieldsFor`): the one rule every relation
 * write and every field menu reads.
 */
import { describe, expect, test } from "bun:test";
import {
  SYSTEM_IDS,
  fieldTypeValue,
  relationFieldFit,
  relationFieldsFor,
  type KbNode,
} from "../src/index.ts";

const AT = "2026-10-17T00:00:00.000Z";

function kb(partial: Pick<KbNode, "id" | "text"> & Partial<KbNode>): KbNode {
  return { props: {}, children: [], createdAt: AT, updatedAt: AT, ...partial };
}

function fieldNode(id: string, type: "ref" | "text", extra: KbNode["props"] = {}): KbNode {
  return kb({
    id,
    text: id.slice(2),
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
      [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue(type)],
      ...extra,
    },
  });
}

const nodes = new Map(
  [
    kb({ id: "b", text: "B", props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t.idea" }] } }),
    kb({ id: "c", text: "C" }),
    fieldNode("f.influences", "ref"),
    fieldNode("f.note", "text"),
    fieldNode("f.about", "ref", { [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: "t.idea" }] }),
    fieldNode("f.owner", "ref"),
    fieldNode("sys.f.kept", "ref"),
    kb({
      id: "f.loose",
      text: "loose",
      props: { [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")] },
    }),
  ].map((n) => [n.id, n]),
);
const noQuery = () => [];
const fit = (field: string, target: string) => {
  const node = nodes.get(field);
  if (node === undefined) throw new Error(`no ${field}`);
  return relationFieldFit(node, target, nodes, noQuery);
};

describe("relationFieldFit", () => {
  test("a ref field fits a target it allows; no ref field, or a target it does not allow, does not", () => {
    expect(fit("f.influences", "c")).toBe("fits");
    expect(fit("f.about", "b")).toBe("fits");
    expect(fit("f.about", "c")).toBe("not-allowed");
    expect(fit("f.note", "b")).toBe("not-ref");
  });

  test("a system field, and a node that is no field, type no relation", () => {
    expect(fit("sys.f.kept", "c")).toBe("system");
    expect(fit("f.loose", "c")).toBe("not-field");
  });
});

describe("relationFieldsFor", () => {
  test("offers the ref fields that allow the target, and only them, by text", () => {
    const ids = (target: string) => relationFieldsFor(nodes, target, noQuery).map((f) => f.id);
    expect(ids("b")).toEqual(["f.about", "f.influences", "f.owner"]);
    expect(ids("c")).toEqual(["f.influences", "f.owner"]);
  });

  test("offers exactly the nodes the rule says fit, for every target", () => {
    for (const target of nodes.keys()) {
      const offered = new Set(relationFieldsFor(nodes, target, noQuery).map((f) => f.id));
      for (const node of nodes.values()) {
        expect([node.id, offered.has(node.id)]).toEqual([node.id, fit(node.id, target) === "fits"]);
      }
    }
  });
});
