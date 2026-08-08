/**
 * JSON Canvas color presets ("1"–"6") → theme-safe oklch tokens.
 * Spec leaves hex undefined so apps can brand; hex strings pass through.
 */

export const CANVAS_COLOR_PRESETS = [
  { id: "1", label: "red", css: "oklch(0.65 0.18 25)" },
  { id: "2", label: "orange", css: "oklch(0.72 0.16 55)" },
  { id: "3", label: "yellow", css: "oklch(0.82 0.14 95)" },
  { id: "4", label: "green", css: "oklch(0.7 0.14 145)" },
  { id: "5", label: "cyan", css: "oklch(0.72 0.12 210)" },
  { id: "6", label: "purple", css: "oklch(0.65 0.16 300)" },
] as const;

export type CanvasColorPresetId = (typeof CANVAS_COLOR_PRESETS)[number]["id"];

const PRESET_CSS: Record<string, string> = Object.fromEntries(
  CANVAS_COLOR_PRESETS.map((p) => [p.id, p.css]),
);

/** Resolve a canvas color string to a CSS color, or undefined if unset. */
export function resolveCanvasColor(color?: string): string | undefined {
  if (!color) return undefined;
  const preset = PRESET_CSS[color];
  if (preset) return preset;
  return color;
}

/** Border + translucent fill suitable for shape cards. */
export function canvasColorStyle(color?: string): {
  borderColor?: string;
  backgroundColor?: string;
  color?: string;
} {
  const resolved = resolveCanvasColor(color);
  if (!resolved) return {};
  return {
    borderColor: resolved,
    backgroundColor: `color-mix(in oklab, ${resolved} 14%, transparent)`,
    color: resolved,
  };
}
