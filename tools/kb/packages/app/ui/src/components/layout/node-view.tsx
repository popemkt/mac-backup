import { useMemo } from "react";
import { Result } from "effect";
import { paramsFrom, resolveNodeView, type HeldViewTarget, type NodeParams } from "@kb/views";
import { NotFound } from "@/components/ui/not-found";
import { ViewSlot } from "@/components/ui/view-slot";
import { WorkspaceState } from "@/components/ui/workspace-state";
import { logWarn } from "@/lib/log";
import { RoutePoint, pageFrameOf, useContributions, type ViewProps } from "@/lib/plugins";
import { ScrollRegion } from "./pane-frame";
import { schemaOf } from "@/lib/schema";
import { usePageCatalog } from "@/lib/view-catalog";
import { useOutlineStore } from "@/stores/outline.store";

/** The one "cannot be shown here" state, naming the view by its label. */
function unavailable(label: string) {
  return (
    <WorkspaceState
      title="This view cannot be shown here"
      description={`${label}: its plugin is not loaded, or a pane around it already shows it.`}
    />
  );
}

/**
 * `/node/<id>[/<view>]`: a node in its default view, or through one view
 * (`resolveNodeView`, the one rule). It draws the view it resolves to in a
 * slot of its own, shown for the view node or the node, so a layout that
 * opens itself again is a repeat the slot refuses.
 */
export function NodeViewSurface({ params }: ViewProps<NodeParams>) {
  // Views and their hosts are read from the whole graph, whatever scope the outline is in.
  const schema = useOutlineStore(schemaOf);
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
  // A view the server lists that no plugin on this page holds the key of.
  if (target.success.key === null) return unavailable(target.success.listed.label);
  return <HeldView target={target.success} />;
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
      fallback={unavailable(target.key.label)}
    />
  );
  // Framed as the route that opens the view frames it; a view no route opens fills the pane.
  return pageFrameOf(routes, target.key, decoded.success) === "scroll" ? (
    <ScrollRegion scroll>{slot}</ScrollRegion>
  ) : (
    <div className="flex h-full min-h-0 flex-1 flex-col">{slot}</div>
  );
}
