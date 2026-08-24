import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bullet } from "@/components/outline/bullet";
import { stubOutlineNode } from "./fixtures";

const noop = (): void => undefined;

const meta = {
  title: "Outline/Bullet",
  component: Bullet,
} satisfies Meta<typeof Bullet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Leaf note — no children, no collapse affordance. */
export const Leaf: Story = {
  args: {
    node: stubOutlineNode({ id: "n1", text: "Leaf note" }),
    onClick: noop,
  },
};

/** Branch with children, collapsed. */
export const CollapsedBranch: Story = {
  args: {
    node: stubOutlineNode({
      id: "n2",
      text: "Branch",
      children: ["c1", "c2", "c3"],
      collapsed: true,
    }),
    collapsible: true,
    onClick: noop,
  },
};

/** Live query node gets the query bullet glyph. */
export const QueryKind: Story = {
  args: {
    node: stubOutlineNode({
      id: "n3",
      text: "Live query",
      tags: [{ id: "sys.tag.query", name: "query", color: "#8b5cf6" }],
    }),
    collapsible: true,
    onClick: noop,
  },
};

/** `kindOverride` forces the media glyph regardless of node shape. */
export const MediaOverride: Story = {
  args: {
    node: stubOutlineNode({ id: "n.media", text: "Photo" }),
    kindOverride: "media",
    onClick: noop,
  },
};
