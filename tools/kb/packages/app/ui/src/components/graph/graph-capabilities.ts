import { GRAPH_RENDERERS } from "./graph-renderers";
import type { LensLinkStyle, LensRenderer } from "@/lib/graph-lens";
import { LINK_STYLES } from "@/lib/graph-link-styles";

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
  | "autorotate"
  | "theme"
  | "linkStyle";
export function settingDisabledReason(
  renderer: LensRenderer,
  setting: GraphSetting,
): string | undefined {
  return GRAPH_RENDERERS[renderer]?.settings.includes(setting) === true
    ? undefined
    : "This renderer does not support this setting";
}

/**
 * What a renderer that draws links but cannot move them says of a flowing
 * style: it draws the style's shape, still (`lib/graph-link-styles`).
 */
export function linkStyleNote(renderer: LensRenderer, style: LensLinkStyle): string | undefined {
  const definition = GRAPH_RENDERERS[renderer];
  if (definition?.settings.includes("linkStyle") !== true) return undefined;
  return LINK_STYLES[style].flowing && definition.linkMotion !== true
    ? "Drawn still here: the dashes move in 3D"
    : undefined;
}
