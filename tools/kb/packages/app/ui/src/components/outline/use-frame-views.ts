import { useMemo } from "react";
import { isViewNode } from "@kb/model";
import {
  type FamilyView,
  familyViews,
  type FrameView,
  frameViewNodeIdOf,
  frameViewThrough,
  type OutlineNode,
  schemaOf,
  useContributions,
  usePageGraph,
  ViewPoint,
} from "@kb/ui-sdk";
import { isFrameViewKey, type FrameViewKey } from "@kb/views";

/** The frame views provided, in their pickers' order: live, as `ViewPoint` holds them. */
export function useFrameViews(): readonly FamilyView<FrameViewKey>[] {
  const views = useContributions(ViewPoint);
  return useMemo(() => familyViews(views, isFrameViewKey), [views]);
}

/** Just their keys: what a frame's view node resolves against (`frameViewOf`). */
function useFrameViewKeys(): readonly FrameViewKey[] {
  const views = useFrameViews();
  return useMemo(() => views.map((view) => view.key), [views]);
}

/**
 * The view node `frame` shows its children through, live, read from the
 * schema (the whole graph, `frameViewNodeIdOf`): the store is read for that
 * one node, so a host re-renders when its view node changes and not otherwise.
 */
export function useFrameViewNode(frame: OutlineNode | undefined): OutlineNode | undefined {
  return usePageGraph((s) => {
    const schema = schemaOf(s);
    const id = frameViewNodeIdOf(frame, schema);
    return id === null ? undefined : schema.get(id);
  });
}

/** The view `frame` shows its children in, live (`frameViewOf`). */
export function useFrameView(frame: OutlineNode | undefined): FrameView | null {
  const views = useFrameViewKeys();
  const viewNode = useFrameViewNode(frame);
  return useMemo(
    () =>
      frameViewThrough(
        frame,
        viewNode !== undefined && isViewNode(viewNode) ? viewNode : null,
        views,
      ),
    [frame, viewNode, views],
  );
}
