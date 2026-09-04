import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextCard } from "@/components/canvas/canvas-card";
import type { CanvasTextNode } from "@kb/canvas";

const noop = (): void => undefined;
const noopPort = (): void => undefined;

function textCard(
  partial: Partial<CanvasTextNode> & Pick<CanvasTextNode, "id" | "text">,
): CanvasTextNode {
  return {
    type: "text",
    x: 0,
    y: 0,
    width: 200,
    height: 80,
    ...partial,
  };
}

/** KbNodeCard is store-coupled — covered by canvas component tests, not stories. */
const meta = {
  title: "Canvas/TextCard",
  component: TextCard,
} satisfies Meta<typeof TextCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  args: {
    card: textCard({ id: "c1", text: "Sticky note" }),
    selected: false,
    onSelect: noop,
    onChange: noop,
    onMoveStart: noop,
    onResizeStart: noop,
    onPortDown: noopPort,
  },
};

export const Selected: Story = {
  args: {
    card: textCard({ id: "c2", text: "Selected card" }),
    selected: true,
    onSelect: noop,
    onChange: noop,
    onMoveStart: noop,
    onResizeStart: noop,
    onPortDown: noopPort,
  },
};

export const Empty: Story = {
  args: {
    card: textCard({ id: "c3", text: "" }),
    selected: false,
    onSelect: noop,
    onChange: noop,
    onMoveStart: noop,
    onResizeStart: noop,
    onPortDown: noopPort,
  },
};
