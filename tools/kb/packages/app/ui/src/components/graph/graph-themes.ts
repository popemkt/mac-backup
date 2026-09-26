/**
 * The 3D graph's themes (`lens.theme`), each stated once as the whole scene
 * it dresses: which tokens fill the ground and its edge, the backdrop's pool,
 * the vignette, the fog, the stars, the grain, the bloom and the node
 * surface. The scene, the layers and the tests read this record; nothing
 * else decides how a theme looks (DESIGN-UI → Graph → Graph themes).
 *
 * Values only, and only tokens for colour (Lab principle L1), so every theme
 * looks like itself in each design system, light and dark (P5). No three.
 */
import type { ColorToken } from "@/lib/css-color";
import type { LensTheme } from "@/lib/graph-lens";
import type { NodeSurface } from "./force3d-light";

/** One value for a light page and one for a dark one. */
export interface Variants<T> {
  readonly light: T;
  readonly dark: T;
}

export interface GraphTheme {
  /** The palette's ground (the backdrop at the focal point) and edge (at the frame). */
  readonly ground: Variants<ColorToken>;
  readonly edge: Variants<ColorToken>;
  /** The backdrop's accent warmth and drifting haze, 0–1 (`scene/gpu/backdrop`). */
  readonly backdrop: { readonly warmth: number; readonly haze: number };
  /** How much of the frame's edge fades into the ground, 0–1. */
  readonly vignette: number;
  /** Range fog, as multiples of the camera's distance to its target; null for none. */
  readonly fog: { readonly near: number; readonly far: number } | null;
  /** The starfield's opacity (0: none). */
  readonly stars: Variants<number>;
  /** The post chain's noise, in half-steps: dither on dark, a fine grain on light. */
  readonly grain: Variants<number>;
  /**
   * The bloom's strength; null for a theme that never blooms, whose glow the
   * node light then folds into lift, so no fragment of it passes white.
   */
  readonly bloom: Variants<number> | null;
  /** How a node's surface takes the light (`force3d-light`). */
  readonly surface: NodeSurface;
}

/** The studio every theme started from: the page's card pooled over its ground. */
const STUDIO: Omit<GraphTheme, "surface"> = {
  ground: { light: "--card", dark: "--card" },
  edge: { light: "--muted", dark: "--background" },
  backdrop: { warmth: 0, haze: 0 },
  vignette: 0,
  fog: { near: 0.55, far: 2.6 },
  stars: { light: 0.1, dark: 0.3 },
  grain: { light: 3, dark: 1 },
  bloom: { light: 0.4, dark: 1.15 },
};

/** Keyed by the option set, so a new theme fails the build until it is stated. */
export const GRAPH_THEMES: Readonly<Record<LensTheme, GraphTheme>> = {
  matte: { ...STUDIO, surface: "matte" },
  cel: { ...STUDIO, surface: "cel" },
  fresnel: { ...STUDIO, surface: "fresnel" },
  glass: { ...STUDIO, surface: "glass" },
};

/** A theme's value for the page's variant. */
export function variant<T>(values: Variants<T>, dark: boolean): T {
  return dark ? values.dark : values.light;
}
