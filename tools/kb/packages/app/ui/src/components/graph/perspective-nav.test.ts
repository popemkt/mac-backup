import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { DatascriptIndex, SYSTEM_IDS } from "@kb/ui-sdk";
import { bundledSeed } from "@kb/bundled";
import { listPerspectiveNavItems } from "./perspective-nav";

const wireNode = (id: string, text: string, props: WireNode["props"] = {}): WireNode => ({
  id,
  text,
  props,
  children: [],
  createdAt: "",
  updatedAt: "",
});

/** The props of a view node naming `option`. */
const view = (option: string) => ({
  [SYSTEM_IDS.viewField]: [{ t: "ref" as const, v: option }],
});

describe("the Graph section's selector", () => {
  it("lists graph-perspective nav items", () => {
    // The seed's view options and families: a graph is a view node whose view is a renderer.
    const wire: WireNode[] = [
      ...bundledSeed(),
      wireNode("p1", "Lens A", view("sys.view.graph.tree")),
      wireNode("t1", "A table", view("sys.view.outline.table")),
      wireNode("other", "nope"),
    ];
    expect(listPerspectiveNavItems(new DatascriptIndex(wire), wire)).toEqual([
      { id: SYSTEM_IDS.lensAllMentions, label: "All mentions" },
      { id: "p1", label: "Lens A" },
    ]);
    expect(listPerspectiveNavItems(null, wire)).toEqual([]);
  });
});
