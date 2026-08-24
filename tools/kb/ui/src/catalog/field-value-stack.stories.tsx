import type { Meta, StoryObj } from "@storybook/react-vite";
import { FieldValueStack } from "@/components/outline/fields-section";
import type { NodeMap } from "@/lib/types";

const emptyNodes: NodeMap = new Map();

const meta = {
  title: "Outline/FieldValueStack",
  component: FieldValueStack,
  args: {
    nodeId: "n.subject",
    fieldId: "field.status",
    allowedRefIds: null,
    nodes: emptyNodes,
    readOnly: false,
  },
} satisfies Meta<typeof FieldValueStack>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One value under the label — the common case. */
export const SingleValue: Story = {
  args: {
    fieldType: "text",
    values: [{ t: "str", v: "In progress" }],
  },
};

/**
 * A field with two values under one label. Props are multi-valued; before
 * `FieldValueStack` existed this repeated the whole `FieldRow` (and its
 * label) once per value. The label shows once, values stack beneath it.
 */
export const TwoValues: Story = {
  args: {
    fieldType: "ref",
    values: [
      { t: "ref", v: "n.person.alice" },
      { t: "ref", v: "n.person.bob" },
    ],
  },
};

/** No values yet — one empty typed slot offers itself for input. */
export const Empty: Story = {
  args: {
    fieldType: "text",
    values: [],
  },
};

/**
 * `readOnly` (`sys.*` fields): the remove-value and add-value affordances
 * disappear, but the values themselves still render.
 */
export const ReadOnlySysField: Story = {
  args: {
    fieldId: "sys.f.type",
    fieldType: "ref",
    values: [{ t: "ref", v: "sys.tag" }],
    readOnly: true,
  },
};
