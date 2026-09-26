import type { NodeMap } from "@/lib/types";
import { schemaOf, type SchemaIndex } from "@/lib/schema";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PropValueEditor } from "@/components/outline/field-value";

/** The one constructor, over an unscoped graph: the whole map is the schema. */
function schemaFor(nodes: NodeMap): SchemaIndex {
  return schemaOf({ ontologyId: null, nodes, wireNodes: [] });
}

const nodes = new Map();
const noop = (): void => undefined;

const meta = {
  title: "Outline/PropValueEditor",
  component: PropValueEditor,
} satisfies Meta<typeof PropValueEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CheckboxChecked: Story = {
  args: {
    value: { t: "bool", v: true },
    display: "yes",
    fieldType: "checkbox",
    onCommit: noop,
    schema: schemaFor(nodes),
    outline: nodes,
    onZoomTo: noop,
  },
};

export const TextFilled: Story = {
  args: {
    value: { t: "str", v: "hello" },
    display: "hello",
    fieldType: "text",
    onCommit: noop,
    schema: schemaFor(nodes),
    outline: nodes,
    onZoomTo: noop,
  },
};

export const UrlEmpty: Story = {
  args: {
    value: { t: "str", v: "" },
    display: "",
    fieldType: "url",
    onCommit: noop,
    schema: schemaFor(nodes),
    outline: nodes,
    onZoomTo: noop,
  },
};
