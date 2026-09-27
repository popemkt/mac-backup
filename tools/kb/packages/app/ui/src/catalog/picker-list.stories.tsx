import type { Meta, StoryObj } from "@storybook/react-vite";
import { PickerList } from "@/components/ui/picker-list";
import { pickerRows, type PickerCandidate } from "@/lib/picker";

const noop = (): void => undefined;

const candidates: PickerCandidate[] = [
  { id: "n.project.alpha", label: "Project Alpha" },
  { id: "n.project.alpha-notes", label: "Alpha notes" },
  { id: "n.person.alice", label: "Alice" },
];

const meta = {
  title: "Command/PickerList",
  component: PickerList,
  args: {
    onPick: noop,
    placement: "inline",
  },
} satisfies Meta<typeof PickerList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opened with no query: every candidate, the first highlighted. */
export const FirstHighlighted: Story = {
  args: {
    rows: pickerRows(candidates, { query: "" }),
    activeIndex: 0,
  },
};

/** Arrow-key navigation moved the highlight to a later row. */
export const LaterHighlighted: Story = {
  args: {
    rows: pickerRows(candidates, { query: "" }),
    activeIndex: 2,
  },
};

/** A query that names nothing, where minting is allowed: the create row. */
export const CreateRow: Story = {
  args: {
    rows: pickerRows(candidates, { query: "Beta", canCreate: true }),
    activeIndex: 0,
  },
};

/** Nothing matched and nothing may be minted. */
export const NoMatches: Story = {
  args: {
    rows: pickerRows(candidates, { query: "zzz" }),
    activeIndex: 0,
    emptyText: "No matches",
  },
};
