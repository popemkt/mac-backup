import type { Meta, StoryObj } from "@storybook/react-vite";
import { PropValueEditor } from "@/components/outline/field-value";

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
    nodes,
  },
};

export const TextFilled: Story = {
  args: {
    value: { t: "str", v: "hello" },
    display: "hello",
    fieldType: "text",
    onCommit: noop,
    nodes,
  },
};

export const UrlEmpty: Story = {
  args: {
    value: { t: "str", v: "" },
    display: "",
    fieldType: "url",
    onCommit: noop,
    nodes,
  },
};
