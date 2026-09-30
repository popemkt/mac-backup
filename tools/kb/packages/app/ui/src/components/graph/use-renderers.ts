import { useMemo } from "react";
import type { LensRenderer } from "@/lib/graph-lens";
import { ViewPoint, familyViews, useContributions } from "@/lib/plugins";
import type { FamilyView } from "@/lib/view-key";
import { isRendererKey, type RendererKey } from "./views";

/** The renderers whose views are provided, in their pickers' order. */
export function useRenderers(): readonly FamilyView<RendererKey<unknown>>[] {
  const views = useContributions(ViewPoint);
  return useMemo(() => familyViews(views, isRendererKey), [views]);
}

/** The renderer whose view `renderer` names, or null while none is provided under it. */
export function useRenderer(renderer: LensRenderer): RendererKey<unknown> | null {
  return useRenderers().find(({ key }) => key.option === renderer)?.key ?? null;
}
