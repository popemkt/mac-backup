import { createElement, type ReactElement } from "react";
import { TagChip, TagChipGroup } from "@/components/outline/tag-chip";

/** Catalog: TagChip — static / navigable / with actions. */
export const stories = {
  static: (): ReactElement =>
    createElement(TagChip, {
      tag: { id: "tag.todo", name: "todo", color: "#3b82f6" },
    }),
  navigable: (): ReactElement =>
    createElement(TagChip, {
      tag: { id: "tag.todo", name: "todo", color: "#3b82f6" },
      onClick: () => undefined,
    }),
  withActions: (): ReactElement =>
    createElement(TagChip, {
      tag: { id: "tag.urgent", name: "urgent", color: "#ef4444" },
      onClick: () => undefined,
      onRemove: () => undefined,
    }),
  group: (): ReactElement =>
    createElement(TagChipGroup, {
      tags: [
        { id: "t1", name: "todo", color: "#3b82f6" },
        { id: "t2", name: "work", color: "#22c55e" },
      ],
      onTagClick: () => undefined,
    }),
} as const;
