import { useMemo } from "react";
import { defaultViewIdOf, isViewNode } from "@kb/model";
import { ViewPoint, currentContributions, familyViews, useContributions } from "@/lib/plugins";
import { schemaOf } from "@/lib/schema";
import type { OutlineNode } from "@/lib/types";
import {
  frameViewThrough,
  isFrameViewKey,
  type FrameView,
  type FrameViewKey,
} from "@/lib/view-config";
import type { FamilyView } from "@/lib/view-key";
import { useOutlineStore } from "@/stores/outline.store";

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
 * The node `frame`'s default view names, live, read from the schema (the
 * whole graph, `frameViewNodeOf`): the store is read for that one node, so a
 * host re-renders when its view node changes and not otherwise.
 */
export function useFrameViewNode(frame: OutlineNode | undefined): OutlineNode | undefined {
  const id = defaultViewIdOf(frame);
  return useOutlineStore((s) => (id === null ? undefined : schemaOf(s).get(id)));
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

/**
 * The frame views provided in the UI kernel now: what the outline plugin wires
 * the store's frame-view port (`stores/frame-views`) to while it is loaded.
 */
export function readFrameViews(): readonly FamilyView<FrameViewKey>[] {
  return familyViews(currentContributions(ViewPoint), isFrameViewKey);
}
