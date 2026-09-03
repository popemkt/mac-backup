import type { Meta, StoryObj } from "@storybook/react-vite";
import { NodeTextHost } from "@/components/outline/node-content";

const noop = (): void => undefined;
const noopActivate = (): void => undefined;

const oneTag = [{ id: "tag.todo", name: "todo", color: "#3b82f6" }];

const LONG_TEXT =
  "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon";

const meta = {
  title: "Outline/NodeTextHost",
  component: NodeTextHost,
  // 400px matches the fixed width used by the trailing-pill render spec
  // (ui/tests-render/typography.e2e.ts) so the wrap behaviour it pins is
  // visible here too.
  decorators: [
    (Story) => (
      <div style={{ width: 400 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    onActivate: noopActivate,
    onChange: noop,
    onKeyDown: noop,
  },
} satisfies Meta<typeof NodeTextHost>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A trailing tag pill next to one short line: the pill sits inline at the
 * line's end, nothing wraps.
 */
export const OneLineWithTag: Story = {
  args: {
    nodeId: "n.short",
    content: "Buy milk",
    isActive: false,
    tags: oneTag,
  },
};

/**
 * A trailing tag pill next to content that wraps to several lines. Pinned
 * regression (typography.e2e.ts "a trailing pill yields only the first
 * line"): the pill's float narrows line one only — every later line runs
 * full width. Before the fix, a flex sibling narrowed every line equally.
 */
export const MultilineWithTag: Story = {
  args: {
    nodeId: "n.long",
    content: LONG_TEXT,
    isActive: false,
    tags: oneTag,
  },
};

/**
 * `sys.`-prefixed node ids are read-only (`isSysPrefixed`): the lock glyph
 * replaces the editable content, and no ref/tag mutation affordance shows.
 */
export const ReadOnlySysNode: Story = {
  args: {
    nodeId: "sys.field.status",
    content: "Status",
    isActive: false,
    tags: [{ id: "tag.core", name: "core", color: "#64748b" }],
  },
};

/** `isActive` swaps the read view for the `contentEditable` editor host. */
export const ActiveEditing: Story = {
  args: {
    nodeId: "n.editing",
    content: "Editing this line",
    isActive: true,
    tags: [],
  },
};
