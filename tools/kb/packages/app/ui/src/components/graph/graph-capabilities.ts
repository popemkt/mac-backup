import { GRAPH_RENDERERS } from "./graph-renderers";
import type { LensRenderer } from "@/lib/graph-lens";

/**
 * What the shared frame chrome may drive for a given renderer.
 * Unsupported controls must render disabled with a reason — never look live
 * and no-op (r10 §3.2 / i13 Task 0).
 */
export interface RendererCapabilities {
  fit: boolean;
  zoom: boolean;
  reset: boolean;
  focus: boolean;
  search: boolean;
  selection: boolean;
  dim: boolean;
  drag: boolean;
}

export type CapabilityKey = keyof RendererCapabilities;

export const CAPABILITY_REASONS: Record<CapabilityKey, string> = {
  fit: "Fit view is not available in this renderer",
  zoom: "Zoom is not available in this renderer",
  reset: "Reset camera is not available in this renderer",
  focus: "Focus node is not available in this renderer",
  search: "Search is not available in this renderer",
  selection: "Selection is not available in this renderer",
  dim: "Dim highlighting is not available in this renderer",
  drag: "Node drag is not available in this renderer",
};

/** Registry metadata is shared by the frame and adapter selection. */
export const RENDERER_CAPABILITIES = Object.fromEntries(
  Object.entries(GRAPH_RENDERERS).map(([key, definition]) => [key, definition.capabilities]),
);
export function capabilitiesFor(renderer: LensRenderer): RendererCapabilities {
  return (
    GRAPH_RENDERERS[renderer]?.capabilities ?? {
      fit: false,
      zoom: false,
      reset: false,
      focus: false,
      search: false,
      selection: false,
      dim: false,
      drag: false,
    }
  );
}

export type GraphSetting =
  | "clusterBy"
  | "layout"
  | "spread"
  | "linkDistance"
  | "labelDensity"
  | "showLabels"
  | "curvedLinks"
  | "autorotate";
export function settingDisabledReason(
  renderer: LensRenderer,
  setting: GraphSetting,
): string | undefined {
  return GRAPH_RENDERERS[renderer]?.settings.includes(setting) === true
    ? undefined
    : "This renderer does not support this setting";
}
