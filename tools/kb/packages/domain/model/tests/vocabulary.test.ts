/**
 * The vocabulary nodes are written in — kb's own nodes, tags, fields and a
 * field's options — told apart from the nodes the graph is about.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, isVocabulary, type KbNode } from "../src/index.ts";

const typed = (kind: string): Pick<KbNode, "props"> => ({
  props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: kind }] },
});
const nodes = new Map<string, Pick<KbNode, "props">>([
  ["t.person", typed(SYSTEM_IDS.tag)],
  ["f.status", typed(SYSTEM_IDS.field)],
  ["o.done", { props: {} }],
  ["n.note", { props: {} }],
  ["n.child", { props: {} }],
]);
const parents = new Map([
  ["o.done", "f.status"],
  ["n.child", "n.note"],
]);
const vocabulary = (id: string) =>
  isVocabulary(
    id,
    (of) => nodes.get(of),
    (of) => parents.get(of),
  );

describe("isVocabulary", () => {
  test("kb's own nodes, tags, fields and a field's options are vocabulary; other nodes are not", () => {
    expect(["sys.tag.anything", "t.person", "f.status", "o.done"].map(vocabulary)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(["n.note", "n.child", "n.missing"].map(vocabulary)).toEqual([false, false, false]);
  });
});
