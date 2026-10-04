import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { SYSTEM_IDS } from "@kb/model";
import type { NodeMap, OutlineNode } from "@kb/ui-sdk";
import { paramsFromProps, OutlineSnippetView } from "@kb/views";
import { frameReport } from "@/lib/view-config";
import { snippetRows } from "./snippet-rows";

const AT = "2026-09-30T00:00:00.000Z";
const node = (id: string, children: string[] = [], text = id): OutlineNode => ({
  id,
  text,
  parentId: null,
  children,
  collapsed: false,
  props: {},
  createdAt: AT,
  updatedAt: AT,
  tags: [],
});

/** r → a, b; a → a1 → a2; b refers back to r by its text. */
const NODES: NodeMap = new Map(
  [
    node("r", ["a", "b"]),
    node("a", ["a1"]),
    node("a1", ["a2"]),
    node("a2"),
    node("b", [], "see [[r|the root]]"),
  ].map((n) => [n.id, n]),
);

describe("outline.snippet", () => {
  it("shows the root, then its descendants down to depth, depth-first", () => {
    const rows = snippetRows(NODES, { root: "r", depth: 2, maxRows: 10 });
    expect(rows.map((row) => [row.id, row.depth])).toEqual([
      ["r", 0],
      ["a", 1],
      ["a1", 2],
      ["b", 1],
    ]);
    expect(rows.at(-1)?.text).toBe("see the root");
  });

  it("stops at maxRows, and at depth 0 shows the root alone", () => {
    expect(snippetRows(NODES, { root: "r", depth: 2, maxRows: 2 }).map((r) => r.id)).toEqual([
      "r",
      "a",
    ]);
    expect(snippetRows(NODES, { root: "r", depth: 0, maxRows: 9 }).map((r) => r.id)).toEqual(["r"]);
  });

  it("shows nothing for a root the outline lacks", () => {
    expect(snippetRows(NODES, { root: "gone", depth: 1, maxRows: 6 })).toEqual([]);
  });

  it("reads a stored view node's focus as its root, else the node it is shown for", () => {
    const focus = { [SYSTEM_IDS.lensFocusField]: [{ t: "ref" as const, v: "a" }] };
    expect(
      Result.getOrThrow(paramsFromProps(OutlineSnippetView, focus, "r", frameReport)).root,
    ).toBe("a");
    expect(Result.getOrThrow(paramsFromProps(OutlineSnippetView, {}, "r", frameReport)).root).toBe(
      "r",
    );
    expect(Result.isFailure(paramsFromProps(OutlineSnippetView, {}, null, frameReport))).toBe(true);
  });
});
