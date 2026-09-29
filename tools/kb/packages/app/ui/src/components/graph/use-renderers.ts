import { useMemo } from "react";
import { ViewPoint, localIdOf, useContributions } from "@/lib/plugins";
import { isRendererKey, type RendererKey } from "./views";

/** The renderers whose views are provided, in the order they were contributed. */
export function useRenderers(): readonly RendererKey<unknown>[] {
  const views = useContributions(ViewPoint);
  return useMemo(() => views.map((view) => view.value.key).filter(isRendererKey), [views]);
}

/** The renderer `lens.renderer` names, or null while no view is provided under that name. */
export function useRenderer(name: string): RendererKey<unknown> | null {
  return useRenderers().find((key) => localIdOf(key) === name) ?? null;
}
