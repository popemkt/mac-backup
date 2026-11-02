// How each sphere style is tuned: four knobs per style, kept as plugin settings (`<style>.<knob>` reads as
// `jellyVividness`, `auroraHue`, …) and adjustable on the page. 1 is each style's own look for the scalar knobs, which
// is already vivid; hue turns the style's colours around the wheel, in degrees.
import { SPHERE_STYLES, type SphereStyle } from "./sphere-styles.ts";

export const KNOBS = ["vividness", "motion", "glow", "hue"] as const;
export type Knob = (typeof KNOBS)[number];
export type Tune = Record<Knob, number>;

export const KNOB_LABELS: Record<Knob, string> = { vividness: "Vividness", motion: "Motion", glow: "Glow", hue: "Hue" };

/** Each knob's range, default and slider step. */
export const KNOB_RANGE: Record<Knob, { min: number; max: number; default: number; step: number }> = {
  vividness: { min: 0, max: 2, default: 1, step: 0.05 },
  motion: { min: 0, max: 2, default: 1, step: 0.05 },
  glow: { min: 0, max: 2, default: 1, step: 0.05 },
  hue: { min: -180, max: 180, default: 0, step: 5 },
};

export const DEFAULT_TUNE: Tune = { vividness: 1, motion: 1, glow: 1, hue: 0 };

/** The plugin setting that holds one style's knob. */
export function settingKey(style: SphereStyle, knob: Knob): string {
  return `${style}${knob[0]!.toUpperCase()}${knob.slice(1)}`;
}

/** A knob's value brought into its range (and to a number at all). */
export function clampKnob(knob: Knob, value: unknown): number {
  const r = KNOB_RANGE[knob];
  const n = typeof value === "number" && Number.isFinite(value) ? value : r.default;
  return Math.min(r.max, Math.max(r.min, n));
}

/** Every style's tune, read from settings values (missing or wrong values fall back to the defaults). */
export function tunesFrom(values: Record<string, unknown>): Record<SphereStyle, Tune> {
  return Object.fromEntries(
    SPHERE_STYLES.map(style => [style, Object.fromEntries(KNOBS.map(k => [k, clampKnob(k, values[settingKey(style, k)])])) as Tune]),
  ) as Record<SphereStyle, Tune>;
}

/** A knob's value as the page shows it. */
export function formatKnob(knob: Knob, value: number): string {
  return knob === "hue" ? `${value > 0 ? "+" : ""}${Math.round(value)}°` : `${Math.round(value * 100)}%`;
}
