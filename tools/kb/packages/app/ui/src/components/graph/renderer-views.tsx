import type { ComponentType } from "react";
import { WorkspaceState } from "@/components/ui/workspace-state";
import type { ViewProps } from "@/lib/plugins";
import type { ParamsOf } from "@/lib/view-key";
import {
  ClusterAdapter,
  Force2dAdapter,
  Force3dAdapter,
  TreeAdapter,
  type RendererProps,
} from "./graph-adapters";
import { GraphCanvasErrorBoundary } from "./graph-canvas-error";
import { useGraphFrame } from "./graph-frame";
import { TreemapGraph } from "./treemap-graph";
import type { ClusterView, Force2dView, Force3dView, TreeView, TreemapView } from "./views";

/**
 * What every renderer view is: its params are the settings it reads, and it
 * draws the frame its graph host provides. A throw while drawing shows the
 * graph's own error inside the canvas, reset when the perspective changes;
 * outside a graph host there is no graph, and it says so.
 */
function InGraphFrame<P>({
  Adapter,
  settings,
}: {
  readonly Adapter: ComponentType<RendererProps<P>>;
  readonly settings: P;
}) {
  const frame = useGraphFrame();
  if (frame === null)
    return (
      <WorkspaceState
        title="No graph to draw"
        description="A renderer draws the graph its host extracts."
      />
    );
  return (
    <GraphCanvasErrorBoundary resetKey={frame.layoutKey}>
      <Adapter settings={settings} frame={frame} />
    </GraphCanvasErrorBoundary>
  );
}

export function Force2dRenderer({ params }: ViewProps<ParamsOf<typeof Force2dView>>) {
  return <InGraphFrame Adapter={Force2dAdapter} settings={params} />;
}

export function TreeRenderer({ params }: ViewProps<ParamsOf<typeof TreeView>>) {
  return <InGraphFrame Adapter={TreeAdapter} settings={params} />;
}

export function ClusterRenderer({ params }: ViewProps<ParamsOf<typeof ClusterView>>) {
  return <InGraphFrame Adapter={ClusterAdapter} settings={params} />;
}

export function Force3dRenderer({ params }: ViewProps<ParamsOf<typeof Force3dView>>) {
  return <InGraphFrame Adapter={Force3dAdapter} settings={params} />;
}

export function TreemapRenderer({ params }: ViewProps<ParamsOf<typeof TreemapView>>) {
  return <InGraphFrame Adapter={TreemapGraph} settings={params} />;
}
