import { createElement } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { NodeRow } from "@/components/outline/node-row";

const bullet = createElement("span", { "data-story": "bullet" }, "\u2022");

const meta = {
  title: "Outline/NodeRow",
  component: NodeRow,
} satisfies Meta<typeof NodeRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Depth0: Story = {
  args: {
    depth: 0,
    nodeId: "n.root",
    bullet,
    content: createElement("span", null, "Root row"),
  },
};

export const NestedSelected: Story = {
  args: {
    depth: 2,
    nodeId: "n.child",
    isSelected: true,
    bullet,
    content: createElement("span", null, "Selected nested"),
  },
};

export const Active: Story = {
  args: {
    depth: 1,
    nodeId: "n.active",
    isActive: true,
    isSelected: true,
    bullet,
    content: createElement("span", null, "Active editing"),
  },
};
