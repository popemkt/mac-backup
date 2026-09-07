/**
 * Three-way merge of the node store (`mergeNodeSets`).
 *
 * The cases are the ones a real parallel wave produces: two branches each
 * appending nodes whose ULIDs land on adjacent lines, one branch editing what
 * the other left alone, one branch deleting what the other left alone, and the
 * two branches editing the same node.
 *
 * Red case: make `bytesOf` compare `node.id` instead of the whole node — every
 * "one side is unchanged" case then silently takes the wrong side.
 */
import { describe, expect, test } from "bun:test";
import { canonicalJsonl } from "../src/canonical.ts";
import { mergeNodeSets } from "../src/merge.ts";
import type { KbNode } from "../src/model.ts";

function node(id: string, text: string, updatedAt = "2026-01-01T00:00:00.000Z"): KbNode {
  return {
    id,
    text,
    props: {},
    children: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
  };
}

/** Ids as the store orders them, which is the only order the file has. */
function ids(nodes: readonly KbNode[]): string[] {
  return [...nodes].map((n) => n.id).toSorted();
}

const A = node("01AAA", "a");
const B = node("01BBB", "b");

describe("mergeNodeSets", () => {
  test("both sides append: the tail collision git cannot resolve", () => {
    const base = [A];
    const ours = [A, node("01OUR", "from our branch")];
    const theirs = [A, node("01THEIR", "from their branch")];

    const merged = mergeNodeSets(base, ours, theirs);

    expect(merged.conflicts).toEqual([]);
    expect(ids(merged.nodes)).toEqual(["01AAA", "01OUR", "01THEIR"]);
  });

  test("a side that equals base yields to the side that changed", () => {
    const base = [A, B];
    const ours = [A, B];
    const theirs = [A, node("01BBB", "b, edited", "2026-02-01T00:00:00.000Z")];

    const merged = mergeNodeSets(base, ours, theirs);

    expect(merged.conflicts).toEqual([]);
    expect(merged.nodes.find((n) => n.id === "01BBB")?.text).toBe("b, edited");
  });

  test("a deletion of a base-identical node is honoured", () => {
    const merged = mergeNodeSets([A, B], [A, B], [A]);

    expect(merged.conflicts).toEqual([]);
    expect(ids(merged.nodes)).toEqual(["01AAA"]);
  });

  test("both changed: the newer updatedAt wins, whichever side it is on", () => {
    const base = [B];
    const oursNewer = mergeNodeSets(
      base,
      [node("01BBB", "ours", "2026-03-01T00:00:00.000Z")],
      [node("01BBB", "theirs", "2026-02-01T00:00:00.000Z")],
    );
    expect(oursNewer.conflicts).toEqual([]);
    expect(oursNewer.nodes.at(0)?.text).toBe("ours");

    const theirsNewer = mergeNodeSets(
      base,
      [node("01BBB", "ours", "2026-02-01T00:00:00.000Z")],
      [node("01BBB", "theirs", "2026-03-01T00:00:00.000Z")],
    );
    expect(theirsNewer.conflicts).toEqual([]);
    expect(theirsNewer.nodes.at(0)?.text).toBe("theirs");
  });

  test("both sides made the identical edit: agreement, not conflict", () => {
    const edited = node("01BBB", "same edit", "2026-02-01T00:00:00.000Z");
    const merged = mergeNodeSets([B], [edited], [edited]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.nodes.at(0)?.text).toBe("same edit");
  });

  test("both sides deleted it: agreement, not conflict", () => {
    const merged = mergeNodeSets([A, B], [A], [A]);

    expect(merged.conflicts).toEqual([]);
    expect(ids(merged.nodes)).toEqual(["01AAA"]);
  });

  test("deleted on one side, edited on the other: reported, and nothing lost", () => {
    const merged = mergeNodeSets([B], [], [node("01BBB", "edited", "2026-02-01T00:00:00.000Z")]);

    expect(merged.conflicts).toEqual([{ id: "01BBB", reason: "deleted-and-modified" }]);
    expect(merged.nodes.at(0)?.text).toBe("edited");
  });

  test("both edited to the same stamp: no basis to choose, so it is reported", () => {
    const merged = mergeNodeSets(
      [B],
      [node("01BBB", "ours", "2026-02-01T00:00:00.000Z")],
      [node("01BBB", "theirs", "2026-02-01T00:00:00.000Z")],
    );

    expect(merged.conflicts).toEqual([{ id: "01BBB", reason: "modified-both-same-stamp" }]);
    expect(merged.nodes.at(0)?.text).toBe("ours");
  });

  test("only one side changed: byte-identical to taking that side wholesale", () => {
    const base = [A, B];
    const theirs = [A, node("01BBB", "b, edited", "2026-02-01T00:00:00.000Z"), node("01CCC", "c")];

    const merged = mergeNodeSets(base, base, theirs);

    expect(merged.conflicts).toEqual([]);
    expect(canonicalJsonl(merged.nodes)).toBe(canonicalJsonl(theirs));
  });

  test("output is canonical: sorted by id, one line each, trailing newline", () => {
    const merged = mergeNodeSets([], [node("01ZZZ", "z")], [node("01AAA", "a")]);
    const body = canonicalJsonl(merged.nodes);

    expect(body.endsWith("\n")).toBe(true);
    expect(
      body
        .trimEnd()
        .split("\n")
        .map((l) => JSON.parse(l).id as string),
    ).toEqual(["01AAA", "01ZZZ"]);
    expect(body).not.toContain(" ");
  });
});
