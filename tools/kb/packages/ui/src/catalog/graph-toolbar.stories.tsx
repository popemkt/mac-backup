import type { Meta, StoryObj } from "@storybook/react-vite";
import { GraphToolbar } from "@/components/graph/graph-toolbar";
import { capabilitiesFor } from "@/components/graph/graph-capabilities";
import type { GraphCameraControls } from "@/components/graph/graph-camera-controls";

const FORCE2D = capabilitiesFor("force2d");
const TREE = capabilitiesFor("tree");

const noopControls: GraphCameraControls = {
  fit: () => {},
  zoomIn: () => {},
  zoomOut: () => {},
  reset: () => {},
  focusNode: () => {},
};

const meta = {
  title: "Graph/GraphToolbar",
  component: GraphToolbar,
} satisfies Meta<typeof GraphToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  args: {
    capabilities: FORCE2D,
    controls: noopControls,
    selectedNodeId: null,
    nodes: [
      { id: "n.a", label: "Alpha" },
      { id: "n.b", label: "Beta" },
      { id: "n.c", label: "Gamma" },
    ],
  },
};

export const WithSelection: Story = {
  args: {
    capabilities: FORCE2D,
    controls: noopControls,
    selectedNodeId: "n.a",
    nodes: [
      { id: "n.a", label: "Alpha" },
      { id: "n.b", label: "Beta" },
    ],
  },
};

/** Tree renderer: fewer capabilities (no focus, no dim). */
export const TreePartial: Story = {
  args: {
    capabilities: TREE,
    controls: noopControls,
    selectedNodeId: null,
    nodes: [],
  },
};

/** No renderer camera yet — every control disabled with a reason, never a no-op. */
export const EmptyGraph: Story = {
  args: {
    capabilities: FORCE2D,
    controls: null,
    selectedNodeId: null,
    nodes: [],
  },
};
