import type { LensLinkStyle, LensSetting } from "@/lib/graph-lens";
import { LINK_STYLES } from "@/lib/graph-link-styles";
import type { RendererCapabilities, RendererKey } from "./views";

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

const NONE: RendererCapabilities = {
  fit: false,
  zoom: false,
  reset: false,
  focus: false,
  search: false,
  selection: false,
  dim: false,
  drag: false,
};

/** What the frame may drive; a renderer no view is provided for drives nothing. */
export function capabilitiesFor(renderer: RendererKey<unknown> | null): RendererCapabilities {
  return renderer?.renderer.capabilities ?? NONE;
}

/** Why a setting is off: the renderer's params do not declare it. */
export function settingDisabledReason(
  renderer: RendererKey<unknown> | null,
  setting: LensSetting,
): string | undefined {
  return renderer !== null && Object.hasOwn(renderer.params.fields, setting)
    ? undefined
    : "This renderer does not support this setting";
}

/**
 * What a renderer that draws links but cannot move them says of a flowing
 * style: it draws the style's shape, still (`lib/graph-link-styles`).
 */
export function linkStyleNote(
  renderer: RendererKey<unknown> | null,
  style: LensLinkStyle,
): string | undefined {
  if (renderer === null || settingDisabledReason(renderer, "linkStyle") !== undefined)
    return undefined;
  return LINK_STYLES[style].flowing && renderer.renderer.linkMotion !== true
    ? "Drawn still here: the dashes move in 3D"
    : undefined;
}
