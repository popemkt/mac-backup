import { useMemo } from "react";
import { Result } from "effect";
import { paramsFrom, resolveNodeView, type HeldViewTarget, type NodeParams } from "@kb/views";
import {
  logWarn,
  NotFound,
  pageFrameOf,
  RoutePoint,
  schemaOf,
  useContributions,
  ViewSlot,
  ViewNotLoaded,
  ViewUnavailable,
  WorkspaceState,
  type ViewProps,
} from "@kb/ui-sdk";
import { ScrollRegion } from "./pane-frame";
import { usePageCatalog } from "@/lib/view-catalog";
import { useGraphStore } from "@/stores/graph.store";

/**
 * `/node/<id>[/<view>]`: a node in its default view, or through one view
 * (`resolveNodeView`, the one rule). It draws the view it resolves to in a
 * slot of its own, shown for the view node or the node, so a layout that
 * opens itself again is a repeat the slot refuses.
 */
export function NodeViewSurface({ params }: ViewProps<NodeParams>) {
  // Views and their hosts are read from the whole graph, whatever scope the outline is in.
  const schema = useGraphStore(schemaOf);
  const catalog = usePageCatalog();
  const target = useMemo(
    () =>
      resolveNodeView(
        params,
        catalog,
        (id) => schema.get(id),
        (warning) => logWarn(`[kb/node] ${params.node}: ${warning}`),
      ),
    [params, catalog, schema],
  );
  if (Result.isFailure(target))
    return <NotFound what="Node" id={params.node} back={{ label: "Home", path: "/" }} />;
  const found = target.success;
  // A view no plugin on this page draws, or a view the data names that is broken.
  if (found.key === null)
    return "broken" in found ? (
      <ViewUnavailable why={found.broken} placement="page" />
    ) : (
      <ViewNotLoaded label={found.listed.label} placement="page" />
    );
  return <HeldView target={found} />;
}

/** A view whose key the page holds: its params decoded, drawn in a slot of its own. */
function HeldView({ target }: { readonly target: HeldViewTarget }) {
  const decoded = useMemo(() => paramsFrom(target.key, target.input), [target]);
  const routes = useContributions(RoutePoint);
  if (Result.isFailure(decoded))
    return <WorkspaceState title="This view cannot be shown" description={decoded.failure} />;
  const slot = (
    <ViewSlot
      view={target.key}
      params={decoded.success}
      placement="page"
      subject={target.subject}
      {...(target.viewNode === undefined ? {} : { viewNode: target.viewNode })}
      fallback={<ViewNotLoaded label={target.key.label} placement="page" />}
    />
  );
  // Framed as the route that opens the view frames it; a view no route opens fills the pane.
  return pageFrameOf(routes, target.key, decoded.success) === "scroll" ? (
    <ScrollRegion scroll>{slot}</ScrollRegion>
  ) : (
    <div className="flex h-full min-h-0 flex-1 flex-col">{slot}</div>
  );
}
