/** Theme-independent graph emphasis. Keep semantic node colour and only vary
 * alpha, so search, filters and neighbourhood focus compose predictably. */
export function composeGraphAlpha(...factors: readonly number[]): number {
  return factors.reduce((alpha, factor) => alpha * factor, 1);
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

/** Apply alpha without substituting a theme-specific grey. */
export function withGraphAlpha(color: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const hex = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(color);
  if (hex) {
    const existing = hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1;
    return `#${hex[1]}${Math.round(existing * clamped * 255)
      .toString(16)
      .padStart(2, "0")}`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
    color,
  );
  if (!rgb) return color;
  const existing = rgb[4] ? Number(rgb[4]) : 1;
  return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${existing * clamped})`;
}
