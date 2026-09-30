import { Suspense, createContext, useContext, useMemo, type ReactElement } from "react";
import { ViewErrorBoundary } from "@/components/view-error-boundary";
import { useView, type Placement, type ViewHost } from "@/lib/plugins";
import type { ViewKey } from "@/lib/view-key";

/**
 * How many views may embed one another. A view embeds others by key, and any
 * of them may embed it back (the ontology embeds the graph and the outline),
 * so a cycle is always one registration away; past this depth a slot shows its
 * fallback. Only an embed counts (see {@link ViewSlot}), and the deepest chain
 * of embeds a view legitimately makes today is five: the shell's page, an
 * ontology, its outline, the root frame's view, and a projected frame view
 * under that list. (The graph's is four: the shell's page, an ontology, its
 * graph, a renderer.)
 */
export const MAX_VIEW_DEPTH = 5;

/** The slot around this point of the tree; only `ViewSlot` writes it. */
interface Enclosing {
  /** How many embeds enclose this point. */
  readonly depth: number;
  readonly view: ViewKey<unknown> | null;
  readonly subject: string | undefined;
}

const EnclosingSlot = createContext<Enclosing>({ depth: 0, view: null, subject: undefined });

/**
 * The one way to render a view: the shell's page, and one plugin embedding
 * another's view by key, without importing it. What it promises is stated
 * once, in DESIGN-UI.md → UI points: routes and views.
 *
 * A slot counts toward {@link MAX_VIEW_DEPTH} when it embeds a view. A slot
 * showing the same view as the slot around it, for another subject, is that
 * view going on down its own tree (a list's rows each showing their own frame
 * as a list), not an embed, and costs nothing: a tree is as deep as its data.
 * The same view for the same subject is a cycle, and counts.
 */
export function ViewSlot<P>({
  view,
  params,
  placement,
  fallback,
  subject,
  pending = null,
}: {
  readonly view: ViewKey<P>;
  readonly params: P;
  readonly placement: Placement;
  /**
   * Shown while no view is provided under `view`, when it does not offer
   * `placement`, and past {@link MAX_VIEW_DEPTH}.
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
  const outer = useContext(EnclosingSlot);
  const host = useMemo((): ViewHost => ({ placement }), [placement]);
  const continues = outer.view === view && subject !== undefined && outer.subject !== subject;
  const depth = continues ? outer.depth : outer.depth + 1;
  const enclosing = useMemo((): Enclosing => ({ depth, view, subject }), [depth, view, subject]);
  if (provided === null || !provided.placements.includes(placement) || depth > MAX_VIEW_DEPTH)
    return fallback;
  const { Component } = provided;
  // A view that throws is contained here: its box shows the error, its host
  // stays up. A view that suspends waits here too, so its host never blanks.
  return (
    <EnclosingSlot.Provider value={enclosing}>
      <ViewErrorBoundary
        title="View crashed"
        resetKey={subject === undefined ? view.id : `${view.id}:${subject}`}
      >
        <Suspense fallback={pending}>
          <Component params={params} host={host} />
        </Suspense>
      </ViewErrorBoundary>
    </EnclosingSlot.Provider>
  );
}
