import { useMemo } from "react";
import { ViewPoint, currentContributions, familyViews, useContributions } from "@/lib/plugins";
import { isFrameViewKey, type FrameViewKey } from "@/lib/view-config";
import type { FamilyView } from "@/lib/view-key";

/** The frame views provided, in their pickers' order: live, as `ViewPoint` holds them. */
export function useFrameViews(): readonly FamilyView<FrameViewKey>[] {
  const views = useContributions(ViewPoint);
  return useMemo(() => familyViews(views, isFrameViewKey), [views]);
}

/** Just their keys: what a frame's props resolve against (`frameViewOf`). */
export function useFrameViewKeys(): readonly FrameViewKey[] {
  const views = useFrameViews();
  return useMemo(() => views.map((view) => view.key), [views]);
}

/**
 * The frame views provided in the UI kernel now: what the outline plugin wires
 * the store's frame-view port (`stores/frame-views`) to while it is loaded.
 */
export function readFrameViews(): readonly FamilyView<FrameViewKey>[] {
  return familyViews(currentContributions(ViewPoint), isFrameViewKey);
}
