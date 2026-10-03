/**
 * A chart's look, from the design system's tokens: a Vega-Lite config the
 * chart is compiled under, so a spec's own `config` still wins. Vega paints
 * SVG attributes, which hold no `var()`, so the tokens are read resolved
 * (`readTokenColor`) and read again when the appearance changes, like every
 * renderer that copies token values out (DESIGN-UI.md → Design tokens).
 */
import { readTokenColor } from "@/lib/css-color";
import { graphLabelFont } from "@/lib/graph-label";

/** A type step's size in px, read from the design system (`--type-<step>`). */
function typeStep(step: "label" | "meta" | "ui", fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--type-${step}`);
  const px = Number.parseFloat(raw);
  return Number.isFinite(px) ? px : fallback;
}

/**
 * The chart ramp's steps as categories, in an order that puts neighbours far
 * apart in lightness (3, 5, 2, 4, 1): the ramp is one hue light to dark, so
 * order is all that tells adjacent series apart.
 */
// GAP [[01M4187DVGXP15CV2JX8Z5Q6V2]] A design system carries a sequential chart ramp
// (--chart-1..5) and no categorical palette; categories reorder the ramp.
const CATEGORY_STEPS = [3, 5, 2, 4, 1] as const;

/** The Vega-Lite config every kb chart is drawn under, for the appearance showing now. */
export function chartTheme(): Record<string, unknown> {
  const ink = readTokenColor("--foreground");
  const muted = readTokenColor("--muted-foreground");
  const rule = readTokenColor("--border");
  const accent = readTokenColor("--primary");
  const ground = readTokenColor("--background");
  const ramp = ([1, 2, 3, 4, 5] as const).map((step) => readTokenColor(`--chart-${step}`));
  const categories = CATEGORY_STEPS.map((step) => readTokenColor(`--chart-${step}`));
  const font = graphLabelFont("ui");
  const label = typeStep("label", 11);
  const title = typeStep("meta", 12);
  const guideLabel = { labelColor: muted, labelFont: font, labelFontSize: label };
  const guideTitle = {
    titleColor: muted,
    titleFont: font,
    titleFontSize: title,
    titleFontWeight: 500,
  };
  return {
    background: null,
    font,
    padding: 4,
    view: { stroke: null },
    title: {
      color: ink,
      font,
      fontSize: typeStep("ui", 13),
      fontWeight: 600,
      anchor: "start",
      offset: 12,
    },
    axis: {
      ...guideLabel,
      ...guideTitle,
      domainColor: rule,
      gridColor: rule,
      tickColor: rule,
      ticks: false,
      labelPadding: 6,
      titlePadding: 10,
      labelFlush: false,
      labelOverlap: true,
    },
    axisX: { grid: false, domain: true, labelAngle: 0, labelLimit: 140 },
    axisY: { domain: false, gridDash: [2, 3] },
    axisBand: { grid: false },
    axisQuantitative: { tickCount: 5 },
    scale: { bandPaddingInner: 0.3, bandPaddingOuter: 0.15 },
    legend: { ...guideLabel, ...guideTitle, symbolType: "circle", symbolSize: 64, rowPadding: 6 },
    header: { ...guideLabel, ...guideTitle },
    mark: { color: accent, tooltip: true },
    bar: { color: accent, cornerRadiusEnd: 4, stroke: ground, strokeWidth: 1 },
    rect: { color: accent },
    arc: { stroke: ground, strokeWidth: 2 },
    area: { color: accent, fillOpacity: 0.18, line: { color: accent, strokeWidth: 2 } },
    line: { color: accent, strokeWidth: 2 },
    point: { color: accent, filled: true, size: 90, stroke: ground, strokeWidth: 1.5 },
    circle: { color: accent, size: 90, stroke: ground, strokeWidth: 1.5 },
    rule: { color: muted },
    text: { color: ink, font, fontSize: label },
    range: {
      category: categories,
      ordinal: ramp,
      ramp,
      heatmap: ramp,
    },
  };
}
