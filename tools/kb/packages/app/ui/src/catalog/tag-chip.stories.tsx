import type { Meta, StoryObj } from "@storybook/react-vite";
import { TagChip } from "@/components/outline/tag-chip";

const meta = {
  title: "Outline/TagChip",
  component: TagChip,
} satisfies Meta<typeof TagChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No handlers — a read-only tag, e.g. inside a query result row. */
export const Static: Story = {
  args: {
    tag: { id: "tag.todo", name: "todo", color: "#3b82f6" },
  },
};

/** `onClick` present — zooms to the tag's own node. */
export const Navigable: Story = {
  args: {
    tag: { id: "tag.todo", name: "todo", color: "#3b82f6" },
    onClick: () => undefined,
  },
};

/** `onRemove` present too — hover reveals the ✕ affordance. */
export const WithActions: Story = {
  args: {
    tag: { id: "tag.urgent", name: "urgent", color: "#ef4444" },
    onClick: () => undefined,
    onRemove: () => undefined,
  },
};
