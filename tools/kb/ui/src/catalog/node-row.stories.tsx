import { createElement, type ReactElement } from "react";
import { NodeRow } from "@/components/outline/node-row";

/** Catalog: NodeRow — depth / selection / active content slot. */
export const stories = {
  depth0: (): ReactElement =>
    createElement(NodeRow, {
      depth: 0,
      nodeId: "n.root",
      bullet: createElement("span", { "data-story": "bullet" }, "•"),
      content: createElement("span", null, "Root row"),
    }),
  nestedSelected: (): ReactElement =>
    createElement(NodeRow, {
      depth: 2,
      nodeId: "n.child",
      isSelected: true,
      bullet: createElement("span", { "data-story": "bullet" }, "•"),
      content: createElement("span", null, "Selected nested"),
    }),
  active: (): ReactElement =>
    createElement(NodeRow, {
      depth: 1,
      nodeId: "n.active",
      isActive: true,
      isSelected: true,
      bullet: createElement("span", { "data-story": "bullet" }, "•"),
      content: createElement("span", null, "Active editing"),
    }),
} as const;
