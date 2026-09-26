import { useMemo, type ReactElement } from "react";
import { ViewErrorBoundary } from "@/components/view-error-boundary";
import { useView, type Placement, type ViewHost, type ViewKey } from "@/lib/plugins";

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
  /** Shown while no view is provided under `view`, or it does not offer `placement`. */
  readonly fallback: ReactElement;
}) {
  const provided = useView(view);
  const host = useMemo((): ViewHost => ({ placement }), [placement]);
  if (provided === null || !provided.placements.includes(placement)) return fallback;
  const { Component } = provided;
  // A view that throws is contained here: its box shows the error, its host stays up.
  return (
    <ViewErrorBoundary title="View crashed" resetKey={view.id}>
      <Component params={params} host={host} />
    </ViewErrorBoundary>
  );
}
