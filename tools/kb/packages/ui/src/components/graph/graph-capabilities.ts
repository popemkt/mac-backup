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

const ALL: RendererCapabilities = {
  fit: true,
  zoom: true,
  reset: true,
  focus: true,
  search: true,
  selection: true,
  dim: true,
  drag: true,
};

/** Per-renderer capability table — chrome intersects this with its buttons. */
export const RENDERER_CAPABILITIES: Record<string, RendererCapabilities> = {
  force2d: { ...ALL },
  cluster: {
    ...ALL,
    // Selection card parity lands with shared frame wiring; cluster clicks
    // still navigate today — keep honest until select-in-place is wired.
    selection: false,
  },
  tree: {
    fit: true,
    zoom: true,
    reset: true,
    focus: false,
    search: true,
    selection: true,
    dim: false,
    drag: false,
  },
  force3d: {
    fit: true,
    zoom: true,
    reset: true,
    focus: true,
    search: true,
    selection: true,
    dim: true,
    drag: false,
  },
};

export function capabilitiesFor(renderer: LensRenderer): RendererCapabilities {
  return (
    RENDERER_CAPABILITIES[renderer] ?? {
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
