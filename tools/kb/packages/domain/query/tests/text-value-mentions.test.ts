/**
 * A `[[id]]` token in a text field value is a mention, exactly as one in
 * node text is: a text value is written, rendered and followed like node
 * text, so it references like node text. These pin that on both the rebuild
 * and the incremental path, and that nothing but text carries a token.
 */
import { describe, expect, test } from "bun:test";
import type { KbNode } from "@kb/model";
import { DatascriptIndex, nodeMentions } from "@kb/query";

function node(id: string, over: Partial<KbNode> = {}): KbNode {
  return {
    id,
    text: id,
    props: {},
    children: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const MENTIONS = `[:find ?from ?to :where [?e :node/mentions ?m] [?e :node/id ?from] [?m :node/id ?to]]`;

function mentions(index: DatascriptIndex): string[][] {
  return index
    .runDatalog(MENTIONS)
    .map((row) => row.map(String))
    .toSorted((a, b) => a.join(" ").localeCompare(b.join(" ")));
}

describe("mentions in text values", () => {
  test("nodeMentions reads node text and every text value, in order", () => {
    const n = node("a", {
      text: "see [[x]]",
      props: {
        f_note: [{ t: "str", v: "and [[y|Y]] then [[x]]" }],
        f_count: [{ t: "num", v: 3 }],
        f_link: [{ t: "ref", v: "z" }],
      },
    });
    expect(nodeMentions(n)).toEqual(["x", "y", "x"]);
  });

  test("a text value's token is a backlink, once per target", () => {
    const index = new DatascriptIndex([
      node("a", {
        text: "plain",
        props: { f_note: [{ t: "str", v: "about [[b|B]] and [[b]]" }] },
      }),
      node("b"),
    ]);
    expect(mentions(index)).toEqual([["a", "b"]]);
  });

  test("editing the value moves the mention, incrementally", () => {
    const index = new DatascriptIndex([
      node("a", { props: { f_note: [{ t: "str", v: "[[b]]" }] } }),
      node("b"),
      node("c"),
    ]);
    const builds = index.rebuilds;
    index.applyTx({
      upserts: [node("a", { props: { f_note: [{ t: "str", v: "now [[c]]" }] } })],
      deletes: [],
    });
    expect(index.rebuilds).toBe(builds);
    expect(mentions(index)).toEqual([["a", "c"]]);
  });

  test("a text value's mention heals when its target arrives", () => {
    const index = new DatascriptIndex([
      node("a", { props: { f_note: [{ t: "str", v: "[[b]]" }] } }),
    ]);
    expect(mentions(index)).toEqual([]);
    index.applyTx({ upserts: [node("b")], deletes: [] });
    expect(mentions(index)).toEqual([["a", "b"]]);
  });
});
