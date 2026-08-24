import type { Meta, StoryObj } from "@storybook/react-vite";
import { TagChipGroup } from "@/components/outline/tag-chip";

const meta = {
  title: "Outline/TagChipGroup",
  component: TagChipGroup,
} satisfies Meta<typeof TagChipGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two tags, navigable. */
export const Pair: Story = {
  args: {
    tags: [
      { id: "t1", name: "todo", color: "#3b82f6" },
      { id: "t2", name: "work", color: "#22c55e" },
    ],
    onTagClick: () => undefined,
  },
};

/** Many tags — the group wraps at `max-w-[16rem]`, it does not overflow. */
export const Wrapping: Story = {
  args: {
    tags: [
      { id: "t1", name: "todo", color: "#3b82f6" },
      { id: "t2", name: "work", color: "#22c55e" },
      { id: "t3", name: "urgent", color: "#ef4444" },
      { id: "t4", name: "personal", color: "#a855f7" },
      { id: "t5", name: "reading", color: "#eab308" },
      { id: "t6", name: "someday", color: "#64748b" },
    ],
    onTagClick: () => undefined,
    onTagRemove: () => undefined,
  },
};

/** No tags — the group renders nothing (no empty wrapper). */
export const Empty: Story = {
  args: {
    tags: [],
  },
};
