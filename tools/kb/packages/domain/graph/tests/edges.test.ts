/**
 * The edge projection (`collectEdges`): each kind read from its own carrier,
 * within the node set, with parallel edges of one kind merged into a weight.
 */
import { describe, expect, test } from "bun:test";
import type { EdgeKind } from "@kb/graph";
import { collectEdges } from "../src/index.ts";
import { node } from "./fixtures.ts";

const nodes = [
  node({
    id: "a",
    text: "A mentions [[b|B]] and [[b]] again, and [[a]] itself",
    children: ["c", "a"],
    props: { "field.depends": [{ t: "ref", v: "b" }], "field.owner": [{ t: "ref", v: "c" }] },
  }),
  node({ id: "b", text: "B", props: { "field.note": [{ t: "str", v: "see [[c]]" }] } }),
  node({ id: "c", text: "C mentions [[outside]]" }),
  node({ id: "outside", text: "Outside the set" }),
];
const inSet = new Set(["a", "b", "c"]);
const edges = (...kinds: EdgeKind[]) => collectEdges(nodes, inSet, new Set(kinds));

describe("collectEdges", () => {
  test("a mention is a text token, one edge per target, never onto its source", () => {
    expect(edges("mention")).toEqual([
      { source: "a", target: "b", kind: "mention", weight: 1 },
      { source: "b", target: "c", kind: "mention", weight: 1 },
    ]);
  });

  test("a child edge is the children array, within the set", () => {
    expect(edges("child")).toEqual([{ source: "a", target: "c", kind: "child", weight: 1 }]);
  });

  test("ref-prop draws every ref field as its own kind; prop:<field> draws one", () => {
    expect(edges("ref-prop")).toEqual([
      { source: "a", target: "b", kind: "prop:field.depends", weight: 1 },
      { source: "a", target: "c", kind: "prop:field.owner", weight: 1 },
    ]);
    expect(edges("prop:field.owner")).toEqual([
      { source: "a", target: "c", kind: "prop:field.owner", weight: 1 },
    ]);
  });

  test("the kinds stay disjoint: a ref prop is not also a mention", () => {
    expect(edges("mention", "ref-prop").map((e) => `${e.kind}:${e.source}->${e.target}`)).toEqual([
      "mention:a->b",
      "mention:b->c",
      "prop:field.depends:a->b",
      "prop:field.owner:a->c",
    ]);
  });

  test("parallel edges of one kind are one edge, weighted by their count", () => {
    const twice = [
      node({ id: "x", text: "x", children: ["y", "y"] }),
      node({ id: "y", text: "y" }),
    ];
    expect(collectEdges(twice, new Set(["x", "y"]), new Set(["child"]))).toEqual([
      { source: "x", target: "y", kind: "child", weight: 2 },
    ]);
  });

  test("an edge leaving the set is not drawn", () => {
    expect(edges("mention").some((e) => e.target === "outside")).toBe(false);
  });
});
