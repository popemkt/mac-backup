/**
 * The 3D graph's themes (`lens.theme`), each stated once as the whole scene
 * it dresses: which tokens fill the ground and its edge, the backdrop's pool,
 * the fog, the stars, the grain, the bloom, the node surface, the links'
 * tone and the labels. The scene, the layers and the tests read this record; nothing
 * else decides how a theme looks (DESIGN-UI → Graph → Graph themes).
 *
 * Values only, and only tokens for colour (Lab principle L1), so every theme
 * looks like itself in each design system, light and dark (P5). No three.
 */
import type { ColorToken } from "@/lib/css-color";
import type { GraphLabelFace } from "@/lib/graph-label";
import type { LensTheme } from "@/lib/graph-lens";
import type { NodeSurface } from "./force3d-light";

/** One value for a light page and one for a dark one. */
export interface Variants<T> {
  readonly light: T;
  readonly dark: T;
}

/** How a theme sets its labels. */
export interface LabelStyle {
  readonly face: GraphLabelFace;
  readonly weight: number;
  /** Set in capitals, and tracked this many CSS pixels apart. */
  readonly upper: boolean;
  readonly tracking: number;
  /** What keeps a label legible over the scene behind it. */
  readonly halo: "soft" | "stroke" | "plate" | "frost";
  /** Above its node's silhouette, or right of it, as a row's text stands beside its bullet. */
  readonly placement: "above" | "right";
}

/** How a theme draws its links, over `--graph-edge` (the resting colour and alpha). */
export interface LinkTone {
  /** The resting alpha's multiple. */
  readonly strength: number;
  /** The source end's share of a link's light: below 1, a link brightens toward its target. */
  readonly source: number;
  /** How far the resting colour leans toward the accent, 0–1. */
  readonly accent: number;
}

export interface GraphTheme {
  /** The palette's ground (the backdrop at the focal point) and edge (at the frame). */
  readonly ground: Variants<ColorToken>;
  readonly edge: Variants<ColorToken>;
  /**
   * The backdrop's accent warmth and haze, 0–1 (`scene/gpu/backdrop`). The
   * haze stands still: the graph's stage draws only while something moves.
   */
  readonly backdrop: { readonly warmth: number; readonly haze: number };
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
  readonly links: LinkTone;
  readonly labels: LabelStyle;
}

/**
 * Matte — the studio: the card's colour pooled at the focal point over the
 * page, fine stars, range fog, a soft key and an ink rim, links brightening
 * source to target, labels in the graph face on a soft halo of the ground.
 * The quiet default the others are measured against.
 */
const MATTE: GraphTheme = {
  ground: { light: "--card", dark: "--card" },
  edge: { light: "--muted", dark: "--background" },
  backdrop: { warmth: 0, haze: 0 },
  fog: { near: 0.55, far: 2.6 },
  stars: { light: 0.1, dark: 0.3 },
  grain: { light: 3, dark: 1 },
  bloom: { light: 0.4, dark: 1.15 },
  surface: "matte",
  links: { strength: 1, source: 0.3, accent: 0 },
  labels: {
    face: "graph",
    weight: 500,
    upper: false,
    tracking: 0,
    halo: "soft",
    placement: "above",
  },
};

/**
 * Cel — ink on paper: a flat ground (no pool, stars, fog or grain), the key
 * in hard bands under a heavy ink outline, links as even ink strokes, bold
 * labels on a ruled plate. A print does not glow: no bloom.
 */
const CEL: GraphTheme = {
  ground: { light: "--background", dark: "--background" },
  edge: { light: "--background", dark: "--background" },
  backdrop: { warmth: 0, haze: 0 },
  fog: null,
  stars: { light: 0, dark: 0 },
  grain: { light: 0, dark: 0 },
  bloom: null,
  surface: "cel",
  links: { strength: 1.9, source: 1, accent: 0 },
  labels: {
    face: "graph",
    weight: 700,
    upper: false,
    tracking: 0,
    halo: "plate",
    placement: "above",
  },
};

/**
 * Fresnel — the night instrument: a pool falling away to the frame under a
 * still haze, more and brighter stars, a
 * quiet body under a bright grazing rim, links leaning to the accent, labels
 * set in the monospace face in tracked capitals, and the strongest bloom.
 */
const FRESNEL: GraphTheme = {
  ground: { light: "--background", dark: "--card" },
  edge: { light: "--muted", dark: "--background" },
  backdrop: { warmth: 0, haze: 0.45 },
  fog: { near: 0.45, far: 2.2 },
  stars: { light: 0.2, dark: 0.6 },
  grain: { light: 3, dark: 1 },
  bloom: { light: 0.7, dark: 1.7 },
  surface: "fresnel",
  links: { strength: 1.25, source: 0.15, accent: 0.45 },
  labels: {
    face: "mono",
    weight: 500,
    upper: true,
    tracking: 1.2,
    halo: "soft",
    placement: "above",
  },
};

/**
 * Glass — the aquarium: a warm pool of the accent, a soft haze, fog that
 * starts close so depth reads, no stars; the ground seen through a tinted
 * body with a tight glint, faint links, light labels on a frosted chip.
 */
const GLASS: GraphTheme = {
  ground: { light: "--card", dark: "--card" },
  edge: { light: "--muted", dark: "--background" },
  backdrop: { warmth: 0.22, haze: 0.25 },
  fog: { near: 0.5, far: 2.4 },
  stars: { light: 0, dark: 0 },
  grain: { light: 2, dark: 1 },
  bloom: { light: 0.35, dark: 1.25 },
  surface: "glass",
  links: { strength: 0.65, source: 0.2, accent: 0.2 },
  labels: {
    face: "graph",
    weight: 400,
    upper: false,
    tracking: 0,
    halo: "frost",
    placement: "above",
  },
};

/** Keyed by the option set, so a new theme fails the build until it is stated. */
export const GRAPH_THEMES: Readonly<Record<LensTheme, GraphTheme>> = {
  matte: MATTE,
  cel: CEL,
  fresnel: FRESNEL,
  glass: GLASS,
};

/** A theme's value for the page's variant. */
export function variant<T>(values: Variants<T>, dark: boolean): T {
  return dark ? values.dark : values.light;
}
