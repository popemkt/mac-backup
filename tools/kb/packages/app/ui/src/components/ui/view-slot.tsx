import { createContext, useContext, useMemo, type ReactElement } from "react";
import { ViewErrorBoundary } from "@/components/view-error-boundary";
import { useView, type Placement, type ViewHost, type ViewKey } from "@/lib/plugins";

/**
 * How many slots may nest. A view embeds others by key, and any of them may
 * embed it back (the ontology embeds the graph and the outline), so a cycle
 * is always one registration away; past this depth a slot shows its fallback.
 */
export const MAX_VIEW_DEPTH = 4;

/** How many slots enclose this point of the tree; only `ViewSlot` writes it. */
const ViewDepth = createContext(0);

/**
 * The one way to render a view: the shell's page, and one plugin embedding
 * another's view by key, without importing it. What it promises is stated
 * once, in DESIGN-UI.md → UI points: routes and views.
 */
export function ViewSlot<P>({
  view,
  params,
  placement,
  fallback,
}: {
  readonly view: ViewKey<P>;
  readonly params: P;
  readonly placement: Placement;
  /**
   * Shown while no view is provided under `view`, when it does not offer
   * `placement`, and past {@link MAX_VIEW_DEPTH}.
   */
  readonly fallback: ReactElement;
}) {
  const provided = useView(view);
  const depth = useContext(ViewDepth);
  const host = useMemo((): ViewHost => ({ placement }), [placement]);
  if (provided === null || !provided.placements.includes(placement) || depth >= MAX_VIEW_DEPTH)
    return fallback;
  const { Component } = provided;
  // A view that throws is contained here: its box shows the error, its host stays up.
  return (
    <ViewDepth.Provider value={depth + 1}>
      <ViewErrorBoundary title="View crashed" resetKey={view.id}>
        <Component params={params} host={host} />
      </ViewErrorBoundary>
    </ViewDepth.Provider>
  );
}
