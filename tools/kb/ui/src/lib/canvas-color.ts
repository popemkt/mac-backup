/**
 * JSON Canvas color presets ("1"–"6") → theme CSS custom properties
 * (`--canvas-color-N` on :root / .dark). Hex and other literals pass through.
 */

export const CANVAS_COLOR_PRESETS = [
  { id: "1", label: "red", css: "var(--canvas-color-1)" },
  { id: "2", label: "orange", css: "var(--canvas-color-2)" },
  { id: "3", label: "yellow", css: "var(--canvas-color-3)" },
  { id: "4", label: "green", css: "var(--canvas-color-4)" },
  { id: "5", label: "cyan", css: "var(--canvas-color-5)" },
  { id: "6", label: "purple", css: "var(--canvas-color-6)" },
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
