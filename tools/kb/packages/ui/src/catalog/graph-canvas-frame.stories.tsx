import type { Meta, StoryObj } from "@storybook/react-vite";
import { GraphCanvasFrame } from "@/components/graph/graph-canvas-frame";
import type { GraphCameraControls } from "@/components/graph/graph-camera-controls";
import type { LensNode } from "@/lib/graph-lens";

const noop = (): void => undefined;

const controls: GraphCameraControls = {
  fit: () => {},
  zoomIn: () => {},
  zoomOut: () => {},
  reset: () => {},
  focusNode: () => {},
};

const nodes: LensNode[] = [
  { id: "n.a", label: "Alpha", color: "#3b82f6", size: 4, clusterKey: "todo", tags: ["todo"], degree: 3 },
  { id: "n.b", label: "Beta", color: "#3b82f6", size: 4, clusterKey: "todo", tags: ["todo"], degree: 1 },
  { id: "n.c", label: "Gamma", color: "#22c55e", size: 4, clusterKey: "work", tags: ["work"], degree: 2 },
];

/** A stand-in for the renderer canvas (sigma / force3d / tree) — the frame
 * owns the chrome that surrounds whatever draws the pixels. */
function FakeCanvas() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-foreground, #888)",
        opacity: 0.4,
      }}
    >
      renderer canvas
    </div>
  );
}

const meta = {
  title: "Graph/GraphCanvasFrame",
  component: GraphCanvasFrame,
  decorators: [
    (Story) => (
      <div style={{ position: "relative", height: 480, width: "100%" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    renderer: "force2d",
    controls,
    selectedNodeId: null,
    selection: null,
    onClearSelection: noop,
    onOpenNode: noop,
    onSearchChange: noop,
    onFilterChange: noop,
  },
} satisfies Meta<typeof GraphCanvasFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  args: {
    nodes,
    children: <FakeCanvas />,
  },
};

/** No nodes at all: the legend hides itself (`buckets.length <= 1`), the
 * toolbar's search has nothing to match. */
export const Empty: Story = {
  args: {
    nodes: [],
    children: <FakeCanvas />,
  },
};

/** `queryError` set: the frame swaps the canvas for an in-place error
 * message and leaves the toolbar/legend chrome interactive (r10 §2 row 10). */
export const QueryError: Story = {
  args: {
    nodes,
    children: <FakeCanvas />,
    queryError: "resolveNodeSet: unknown tag id \"#missing\"",
  },
};
