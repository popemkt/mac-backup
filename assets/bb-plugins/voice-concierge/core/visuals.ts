// Canonical visual identities and numeric control metadata; independent of the renderer.
export interface VisualKnob {
  label: string;
  min: number;
  max: number;
  default: number;
  step: number;
  unit?: "degrees" | "seconds";
}
export const COMMON_KNOBS = {
  vividness: { label: "Vividness", min: 0, max: 2, default: 1, step: 0.05 },
  motion: { label: "Motion", min: 0, max: 2, default: 1, step: 0.05 },
  glow: { label: "Glow", min: 0, max: 2, default: 1, step: 0.05 },
  hue: { label: "Hue", min: -180, max: 180, default: 0, step: 5, unit: "degrees" },
} as const;
export const VISUALS = {
  jelly: {
    interaction: "call",
    geometry: "sphere",
    label: "Candy jelly",
    swatch: "radial-gradient(circle at 35% 30%, #ffd7c8 0%, #ff5a4a 38%, #8a0f22 100%)",
    knobs: {},
  },
  moonstone: {
    interaction: "call",
    geometry: "sphere",
    label: "Moonstone",
    swatch: "radial-gradient(circle at 35% 30%, #eef2ff 0%, #9fb0d6 45%, #2b3350 100%)",
    knobs: {},
  },
  aurora: {
    interaction: "call",
    geometry: "sphere",
    label: "Aurora orb",
    swatch: "linear-gradient(180deg, #d24bd6 0%, #2fd6c3 45%, #3cff8a 62%, #0b1226 100%)",
    knobs: {},
  },
  frosted: {
    interaction: "call",
    geometry: "sphere",
    label: "Frosted globe",
    swatch: "radial-gradient(circle at 50% 55%, #fff1d6 0%, #f0c98a 28%, #9ea3ad 60%, #4a4d55 100%)",
    knobs: {},
  },
  chromeOrbit: {
    interaction: "align",
    geometry: "rings",
    label: "Chrome Orbit",
    swatch: "linear-gradient(135deg, #151b2d, #eef4ff 45%, #778499 52%, #d4b9f4)",
    knobs: {
      rings: { label: "Rings", min: 1, max: 9, default: 4, step: 1 },
      interactionStrength: { label: "Interaction", min: 0, max: 2, default: 1, step: 0.05 },
      spacing: { label: "Spacing", min: 0.04, max: 0.14, default: 0.09, step: 0.005 },
      bandWidth: { label: "Band width", min: 0.025, max: 0.15, default: 0.085, step: 0.005 },
      bandThickness: { label: "Band thickness", min: 0.008, max: 0.06, default: 0.018, step: 0.001 },
      roughness: { label: "Roughness", min: 0, max: 0.6, default: 0.16, step: 0.01 },
      iridescence: { label: "Iridescence", min: 0, max: 1, default: 0.25, step: 0.05 },
      tilt: { label: "Tilt", min: 0, max: 75, default: 18, step: 1, unit: "degrees" },
      parallax: { label: "Parallax", min: 0, max: 2, default: 1, step: 0.05 },
      alignHold: { label: "Align hold", min: 0, max: 10, default: 2.5, step: 0.1, unit: "seconds" },
      haloTilt: { label: "Halo tilt", min: 0, max: 85, default: 62, step: 1, unit: "degrees" },
      lightDrift: { label: "Light drift", min: 0, max: 2, default: 1, step: 0.05 }
    }
  },
  aiBlob: {
    interaction: "squish",
    geometry: "sphere",
    label: "AI Blob",
    swatch: "radial-gradient(circle at 45% 40%, #22143e 15%, #a78bfa 65%, #71e6e0 85%, transparent)",
    knobs: {
      hoverTilt: { label: "Hover tilt", min: 0, max: 2, default: 1, step: 0.05 },
      interactionStrength: { label: "Interaction", min: 0, max: 2, default: 1, step: 0.05 },
      pulseStrength: { label: "Pulse strength", min: 0, max: 2, default: 1, step: 0.05 },
      rimWidth: { label: "Rim width", min: 0.3, max: 2, default: 1, step: 0.05 },
      rimIntensity: { label: "Rim intensity", min: 0, max: 2, default: 1, step: 0.05 },
      coreSize: { label: "Core size", min: 0.3, max: 2, default: 1, step: 0.05 },
      coreIntensity: { label: "Core intensity", min: 0, max: 2, default: 1, step: 0.05 },
      glints: { label: "Glints", min: 0, max: 2, default: 1, step: 0.05 },
      halo: { label: "Halo", min: 0, max: 2, default: 1, step: 0.05 },
      noiseScale: { label: "Noise scale", min: 1, max: 8, default: 3, step: 0.1 },
      wobble: { label: "Wobble", min: 0, max: 1, default: 0, step: 0.05 },
      colorSpeed: { label: "Color speed", min: 0, max: 2, default: 1, step: 0.05 },
      reactivity: { label: "Reactivity", min: 0, max: 2, default: 1, step: 0.05 }
    }
  },
  gradientBlob: {
    interaction: "morph",
    geometry: "sphere",
    label: "Gradient Blob",
    swatch: "linear-gradient(135deg, #ffb36b, #fb7185 45%, #8471ee)",
    knobs: {
      cursorMorph: { label: "Cursor morph", min: 0, max: 2, default: 1, step: 0.05 },
      interactionStrength: { label: "Interaction", min: 0, max: 2, default: 1, step: 0.05 },
      breatheStrength: { label: "Breathing", min: 0, max: 1, default: 0.35, step: 0.05 },
      parallax: { label: "Parallax", min: 0, max: 1, default: 0.5, step: 0.05 },
      morphIntensity: { label: "Morph intensity", min: 0, max: 2, default: 1.2, step: 0.05 },
      metallic: { label: "Metallic", min: 0, max: 1, default: 0, step: 0.05 },
      rotationSpeed: { label: "Rotation speed", min: 0, max: 2, default: 1, step: 0.05 }
    }
  },
} as const;
export type VisualStyle = keyof typeof VISUALS;
export const VISUAL_STYLES = Object.keys(VISUALS) as VisualStyle[];
export function controlsFor(style: VisualStyle): Record<string, VisualKnob> { return { ...COMMON_KNOBS, ...VISUALS[style].knobs }; }

/** Visible guidance for gestures; call controls already carry their own labels. */
export const INTERACTION_HINTS = {
  call: "",
  align: "Tap to align · drag to turn",
  squish: "Press to squish · drag to stretch",
  morph: "Move to morph · press and drag",
} as const;
