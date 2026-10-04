import { useMemo } from "react";
import { type LensRenderer, isRendererKey, type RendererKey } from "@kb/views";
import { familyViews, useContributions, ViewPoint, type FamilyView } from "@kb/ui-sdk";

/** The renderers whose views are provided, in their pickers' order. */
export function useRenderers(): readonly FamilyView<RendererKey<unknown>>[] {
  const views = useContributions(ViewPoint);
  return useMemo(() => familyViews(views, isRendererKey), [views]);
}

/** The renderer whose view `renderer` names, or null while none is provided under it. */
export function useRenderer(renderer: LensRenderer): RendererKey<unknown> | null {
  return useRenderers().find(({ key }) => key.option === renderer)?.key ?? null;
}
