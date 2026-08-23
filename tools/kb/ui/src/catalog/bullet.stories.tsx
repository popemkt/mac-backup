import { createElement, type ReactElement } from "react";
import { Bullet } from "@/components/outline/bullet";
import { stubOutlineNode } from "./fixtures";

const noop = (): void => undefined;

/** Catalog: Bullet — leaf / collapsed branch / query / tag. */
export const stories = {
  leaf: (): ReactElement =>
    createElement(Bullet, {
      node: stubOutlineNode({ id: "n1", text: "Leaf note" }),
      onClick: noop,
    }),
  collapsedBranch: (): ReactElement =>
    createElement(Bullet, {
      node: stubOutlineNode({
        id: "n2",
        text: "Branch",
        children: ["c1", "c2", "c3"],
        collapsed: true,
      }),
      collapsible: true,
      onClick: noop,
    }),
  queryKind: (): ReactElement =>
    createElement(Bullet, {
      node: stubOutlineNode({
        id: "n3",
        text: "Live query",
        tags: [{ id: "sys.tag.query", name: "query", color: "#8b5cf6" }],
      }),
      collapsible: true,
      onClick: noop,
    }),
  mediaOverride: (): ReactElement =>
    createElement(Bullet, {
      node: stubOutlineNode({ id: "n.media", text: "Photo" }),
      kindOverride: "media",
      onClick: noop,
    }),
} as const;
