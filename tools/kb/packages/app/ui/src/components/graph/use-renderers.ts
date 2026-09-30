import { useMemo } from "react";
import { ViewPoint, familyViews, useContributions } from "@/lib/plugins";
import { localIdOf, type FamilyView } from "@/lib/view-key";
import { isRendererKey, type RendererKey } from "./views";

/** The renderers whose views are provided, in their pickers' order. */
export function useRenderers(): readonly FamilyView<RendererKey<unknown>>[] {
  const views = useContributions(ViewPoint);
  return useMemo(() => familyViews(views, isRendererKey), [views]);
}

/** The renderer `lens.renderer` names, or null while no view is provided under that name. */
export function useRenderer(name: string): RendererKey<unknown> | null {
  return useRenderers().find(({ key }) => localIdOf(key) === name)?.key ?? null;
}
