import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { WorkspaceState } from "@/components/ui/workspace-state";
import { WorkspaceBoundary } from "@/components/ui/workspace-boundary";

const meta = {
  title: "Workspace/WorkspaceState",
  component: WorkspaceState,
  decorators: [
    (Story) => (
      <div style={{ minHeight: 380, background: "var(--background)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkspaceState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: { title: "Opening your workspace…", loading: true },
};

export const EmptyCanvas: Story = {
  args: {
    title: "Room for a little possibility",
    description:
      "Create a canvas to spread out your nodes, sketch an idea, or follow a connection.",
  },
};

export const EmptyGraph: Story = {
  args: {
    title: "No connections in view yet",
    description: "0 nodes match — edit this perspective’s query to broaden the view.",
  },
};

function MotionStudy() {
  const [take, setTake] = useState(0);
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            kb · motion study 01
          </p>
          <h1 className="mt-2 text-xl font-medium text-foreground">
            A little life between thoughts.
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setTake((value) => value + 1)}
          className="shrink-0 rounded-full border border-border px-4 py-2 text-[12px] text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          Replay arrival
        </button>
      </div>
      <div
        key={take}
        className="grid overflow-hidden rounded-2xl border border-border sm:grid-cols-2"
      >
        <div className="bg-background">
          <WorkspaceState title="Opening your workspace…" loading />
        </div>
        <div className="dark bg-background">
          <WorkspaceState
            title="Room for a little possibility"
            description="A space for ideas to find each other."
          />
        </div>
      </div>
      <p className="mt-5 text-[12px] leading-relaxed text-muted-foreground">
        One soft landing, a curious glance, then stillness. This preview follows your reduced-motion
        preference. Nothing here reads or changes your workspace.
      </p>
    </div>
  );
}

/** An isolated place to review personality before introducing it to the app. */
export const Study: Story = {
  args: { title: "Motion study" },
  render: () => <MotionStudy />,
};

function ReadinessStudy() {
  const [pending, setPending] = useState(true);
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-lg font-medium text-foreground">From a little hello to your ideas.</h1>
        <button
          type="button"
          onClick={() => setPending((value) => !value)}
          className="shrink-0 rounded-full border border-border px-4 py-2 text-[12px] text-foreground hover:bg-muted"
        >
          {pending ? "Reveal workspace" : "Replay loading"}
        </button>
      </div>
      <div className="flex h-80 flex-col overflow-hidden rounded-2xl border border-border bg-background">
        <WorkspaceBoundary pending={pending} title="Opening your workspace…">
          <div className="p-8 text-foreground">
            <p className="mb-6 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              A quiet place to begin
            </p>
            <h2 className="mb-4 text-lg font-medium">Small ideas, interesting connections</h2>
            <ul className="space-y-3 text-[13px] text-muted-foreground">
              <li>· A thought worth keeping</li>
              <li>· Something to explore tomorrow</li>
              <li>· Two ideas that might belong together</li>
            </ul>
          </div>
        </WorkspaceBoundary>
      </div>
      <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
        Content fades in as soon as it is ready. No movement, no minimum loading time.
      </p>
    </div>
  );
}

export const LoadingToReady: Story = {
  args: { title: "Loading to ready" },
  render: () => <ReadinessStudy />,
};
