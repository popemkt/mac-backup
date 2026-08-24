import type { Meta, StoryObj } from "@storybook/react-vite";
import { RefAutocomplete } from "@/components/ref-autocomplete";

const noop = (): void => undefined;

const candidates = [
  { id: "n.project.alpha", text: "Project Alpha", score: 3 },
  { id: "n.project.alpha-notes", text: "Alpha notes", score: 2 },
  { id: "n.person.alice", text: "Alice", score: 1 },
];

const meta = {
  title: "Command/RefAutocomplete",
  component: RefAutocomplete,
  args: {
    onSelect: noop,
  },
} satisfies Meta<typeof RefAutocomplete>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `[[` opened, first candidate highlighted. */
export const FirstHighlighted: Story = {
  args: {
    candidates,
    activeIndex: 0,
  },
};

/** Arrow-key navigation moved the highlight to a later row. */
export const LaterHighlighted: Story = {
  args: {
    candidates,
    activeIndex: 2,
  },
};

/** A single fuzzy match. */
export const OneCandidate: Story = {
  args: {
    candidates: [candidates[0]!],
    activeIndex: 0,
  },
};
