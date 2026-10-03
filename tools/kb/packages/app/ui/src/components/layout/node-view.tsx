import { useMemo } from "react";
import { Result } from "effect";
import { paramsFrom, resolveNodeView, type NodeParams } from "@kb/views";
import { NotFound } from "@/components/ui/not-found";
import { ViewSlot } from "@/components/ui/view-slot";
import { WorkspaceState } from "@/components/ui/workspace-state";
import { logWarn } from "@/lib/log";
import { RoutePoint, pageFrameOf, useContributions, type ViewProps } from "@/lib/plugins";
import { ScrollRegion } from "./pane-frame";
import { schemaOf } from "@/lib/schema";
import { useOutlineStore } from "@/stores/outline.store";

const UNAVAILABLE = (
  <WorkspaceState
    title="This view cannot be shown here"
    description="Its plugin is not loaded, or a pane around it already shows it."
  />
);

/**
 * `/node/<id>[/<view>]`: a node in its default view, or through one view
 * (`resolveNodeView`, the one rule). It draws the view it resolves to in a
 * slot of its own, shown for the view node or the node, so a layout that
 * opens itself again is a repeat the slot refuses.
 */
export function NodeViewSurface({ params }: ViewProps<NodeParams>) {
  // Views and their hosts are read from the whole graph, whatever scope the outline is in.
  const schema = useOutlineStore(schemaOf);
  const target = useMemo(
    () =>
      resolveNodeView(
        params,
        (id) => schema.get(id),
        (warning) => logWarn(`[kb/node] ${params.node}: ${warning}`),
      ),
    [params, schema],
  );
  const decoded = useMemo(
    () => Result.flatMap(target, (found) => paramsFrom(found.key, found.input)),
    [target],
  );
  const routes = useContributions(RoutePoint);
  if (Result.isFailure(target))
    return <NotFound what="Node" id={params.node} back={{ label: "Home", path: "/" }} />;
  if (Result.isFailure(decoded))
    return <WorkspaceState title="This view cannot be shown" description={decoded.failure} />;
  const slot = (
    <ViewSlot
      view={target.success.key}
      params={decoded.success}
      placement="page"
      subject={target.success.subject}
      fallback={UNAVAILABLE}
    />
  );
  // Framed as the route that opens the view frames it; a view no route opens fills the pane.
  return pageFrameOf(routes, target.success.key, decoded.success) === "scroll" ? (
    <ScrollRegion scroll>{slot}</ScrollRegion>
  ) : (
    <div className="flex h-full min-h-0 flex-1 flex-col">{slot}</div>
  );
}
