import { Suspense, useContext, useMemo, type ReactElement } from "react";
import { EnclosingSlots } from "@/components/ui/slot-chain";
import { ViewErrorBoundary } from "@/components/view-error-boundary";
import { useView, type Placement, type ViewHost } from "@/lib/plugins";
import { slotLink, slotRenders, type SlotChain } from "@/lib/view-key";
import type { ViewKey } from "@kb/views";

/** What a slot shows while its view loads: a quiet placeholder of the box, never a blank. */
const PENDING = (
  <div
    aria-busy="true"
    data-view-pending="true"
    className="min-h-6 rounded-sm bg-foreground/[0.04] motion-safe:animate-pulse"
  />
);

/**
 * The one way to render a view: the shell's page, and one plugin embedding
 * another's view by key, without importing it. What it promises is stated
 * once, in DESIGN-UI.md → UI points: routes and views.
 *
 * Whether it renders is `slotRenders` over the slots around it: a slot that
 * would show the same view for the same subject as any slot around it is a
 * cycle, and shows its fallback; so is one past `MAX_VIEW_DEPTH`.
 */
export function ViewSlot<P>({
  view,
  params,
  placement,
  fallback,
  subject,
  pending = PENDING,
}: {
  readonly view: ViewKey<P>;
  readonly params: P;
  readonly placement: Placement;
  /**
   * Shown while no view is provided under `view`, when it does not offer
   * `placement`, and when `slotRenders` refuses it.
   */
  readonly fallback: ReactElement;
  /**
   * What the host shows the view for (a frame's id, a perspective's), when it
   * may show the same view for another: the error boundary resets when it
   * changes, and it tells a view going on down its tree from a cycle.
   */
  readonly subject?: string;
  /** Shown in the slot's box while the view's code or data is still loading. */
  readonly pending?: ReactElement | null;
}) {
  const provided = useView(view);
  const outer = useContext(EnclosingSlots);
  const host = useMemo((): ViewHost => ({ placement }), [placement]);
  const link = slotLink(view, subject);
  const chain = useMemo((): SlotChain => [...outer, link], [outer, link]);
  if (provided === null || !provided.placements.includes(placement) || !slotRenders(outer, link))
    return fallback;
  const { Component } = provided;
  // A view that throws is contained here: its box shows the error, its host
  // stays up. A view that suspends waits here too, so its host never blanks.
  return (
    <EnclosingSlots.Provider value={chain}>
      <ViewErrorBoundary title="View crashed" resetKey={link}>
        <Suspense fallback={pending}>
          <Component params={params} host={host} />
        </Suspense>
      </ViewErrorBoundary>
    </EnclosingSlots.Provider>
  );
}
