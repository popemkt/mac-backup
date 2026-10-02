import { describe, expect, it } from "vitest";
import { SYSTEM_IDS } from "@kb/model";
import { NeighbourhoodView, TreeView, OutlineSnippetView } from "@kb/views";
import { viewKeyOfNode } from "@/lib/view-node";

const naming = (option: string) => ({
  props: { [SYSTEM_IDS.viewField]: [{ t: "ref" as const, v: option }] },
});

describe("viewKeyOfNode", () => {
  const keys = [NeighbourhoodView, OutlineSnippetView, TreeView];

  it("finds the key whose option the view node names", () => {
    expect(viewKeyOfNode(naming(TreeView.option), keys)).toBe(TreeView);
    expect(viewKeyOfNode(naming(OutlineSnippetView.option), keys)).toBe(OutlineSnippetView);
  });

  it("finds none for a node that is no view node, or names a view not among the keys", () => {
    expect(viewKeyOfNode({ props: {} }, keys)).toBeNull();
    expect(viewKeyOfNode(naming("sys.view.graph.force3d"), keys)).toBeNull();
    expect(viewKeyOfNode(undefined, keys)).toBeNull();
  });
});
