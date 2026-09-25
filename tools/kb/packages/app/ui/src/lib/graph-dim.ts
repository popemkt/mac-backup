import { toRenderableColor } from "./css-color";

/** Theme-independent graph emphasis. Keep semantic node colour and only vary
 * alpha, so search, filters and neighbourhood focus compose predictably. */
export function composeGraphAlpha(...factors: readonly number[]): number {
  return Math.min(1, ...factors);
}

export function graphNodeAlpha(input: {
  includedByFilter: boolean;
  includedBySearch: boolean;
  includedByFocus: boolean;
}): number {
  return composeGraphAlpha(
    input.includedByFilter ? 1 : 0.2,
    input.includedBySearch ? 1 : 0.2,
    input.includedByFocus ? 1 : 0.2,
  );
}

/**
 * The same colour and alpha, premultiplied, for a WebGL renderer that blends
 * `ONE, ONE_MINUS_SRC_ALPHA` (sigma does): it reads a straight-alpha colour
 * as if its channels were already scaled, so a faint link or a dimmed node
 * drew at full brightness. Premultiplied, alpha composes as it should.
 */
export function premultipliedGraphColor(color: string, alpha: number): string {
  const rendered = toRenderableColor(color);
  const rgba =
    rendered === null
      ? null
      : /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/.exec(rendered);
  if (rgba === null) return withGraphAlpha(color, alpha);
  const a = Math.max(0, Math.min(1, (rgba[4] === undefined ? 1 : Number(rgba[4])) * alpha));
  const channel = (raw: string | undefined) => Math.round(Number(raw) * a);
  return `rgba(${channel(rgba[1])}, ${channel(rgba[2])}, ${channel(rgba[3])}, ${a})`;
}

/** Apply alpha without substituting a theme-specific grey. */
export function withGraphAlpha(color: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const hex = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(color);
  if (hex) {
    const existing = hex[2] !== undefined ? Number.parseInt(hex[2], 16) / 255 : 1;
    return `#${hex[1]}${Math.round(existing * clamped * 255)
      .toString(16)
      .padStart(2, "0")}`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
    color,
  );
  if (!rgb) return color;
  const existing = rgb[4] !== undefined ? Number(rgb[4]) : 1;
  return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${existing * clamped})`;
}
