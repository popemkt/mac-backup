/**
 * The mask that keeps a view's script overlays off where the view takes
 * gestures (DESIGN-UI.md → Scripts): the overlay layer shows everywhere
 * except on each region the view names (`ViewLayoutState.interactive`), so
 * nothing a script draws lies over a card, an edge or any other thing a
 * press reaches, and a press always reaches what is drawn where it lands.
 * It is the overlay layer's CSS mask, an SVG built as data with no markup
 * from the script in it.
 */
import type { ScreenRegion } from "@kb/ui-sdk";

const n = (value: number) => (Number.isFinite(value) ? value.toFixed(1) : "0");

/** One region, drawn black: hidden in the mask. */
function hole(region: ScreenRegion): string {
  if ("box" in region) {
    const { left, top, right, bottom } = region.box;
    return `<rect x='${n(left)}' y='${n(top)}' width='${n(right - left)}' height='${n(bottom - top)}' fill='black'/>`;
  }
  const points = region.line.map((p) => `${n(p.x)},${n(p.y)}`).join(" ");
  return `<polyline points='${points}' fill='none' stroke='black' stroke-width='${n(region.width)}' stroke-linecap='round' stroke-linejoin='round'/>`;
}

/** The CSS `mask-image` of a `width` × `height` layer that hides `regions`. */
export function overlayMask(
  regions: readonly ScreenRegion[],
  width: number,
  height: number,
): string {
  const w = n(width);
  const h = n(height);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
    `<mask id='m' maskUnits='userSpaceOnUse' x='0' y='0' width='${w}' height='${h}'>` +
    `<rect width='${w}' height='${h}' fill='white'/>${regions.map(hole).join("")}</mask>` +
    `<rect width='${w}' height='${h}' fill='white' mask='url(#m)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
