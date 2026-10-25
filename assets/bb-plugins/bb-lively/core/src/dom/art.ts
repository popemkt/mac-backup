// The presets' art layer as CSS: per preset, the backdrop and sidebar art
// (domain/presets.ts) and its font tokens, all under
// `:root[data-lively-art][data-lively-preset="<id>"]`, so a preset switch is
// one attribute and the art goes with it. Art is paint, not motion: it has no
// animation, so it stays under reduced motion (and goes with motion "off",
// which writes nothing at all).
//
// Each surface paints its art on a `::before` behind its own content: the
// surface is positioned and isolated, and the layer sits at z-index -1, above
// the surface's own background and below everything in it. Only a surface
// that has art for the active preset is touched. The person's own image (the
// `artImage` setting, `--lively-art-image` on <html>) goes on the preset's
// image surface, under the preset's own layers, washed toward the surface
// color so text stays readable.
import { type ArtLayer, type ArtSurface, ART_SURFACES, DEFAULT_IMAGE_PLACEMENT, type Preset } from "../domain/presets.ts";
import type { Targets } from "./targets.ts";

/** The custom property on <html> holding the person's image as `url("…")`. */
export const ART_IMAGE_PROPERTY = "--lively-art-image";

/** The root attributes the art rules key on (the DOM layer writes them; see stylesheet.ts ROOT). */
export const ART_ROOT = {
  preset: "data-lively-preset",
  /** `on` while the art layer shows. */
  art: "data-lively-art",
  /** `on` while the person's image is set (and the art layer shows). */
  artImage: "data-lively-art-image",
} as const;

/** The stickers root attribute (stylesheet.ts ROOT.stickers). */
const STICKERS = "data-lively-stickers";

/** The color each surface's wash fades the person's image toward: what is painted behind it. */
const SURFACE_COLOR: Readonly<Record<ArtSurface, string>> = {
  backdrop: "var(--lively-canvas)",
  sidebar: "var(--lively-sidebar)",
};

const is = (selector: string) => `:is(${selector})`;

/** Layers as the four background lists (image, size, position, repeat). */
function backgroundLists(layers: ReadonlyArray<ArtLayer>): string {
  const list = (pick: (layer: ArtLayer) => string) => layers.map(pick).join(", ");
  return `  background-image: ${list((layer) => layer.image)};
  background-size: ${list((layer) => layer.size ?? "auto")};
  background-position: ${list((layer) => layer.position ?? "0 0")};
  background-repeat: ${list((layer) => layer.repeat ?? "repeat")};`;
}

function surfaceRule(selector: string, layers: ReadonlyArray<ArtLayer>, mask: string | undefined): string {
  return `${selector} { position: relative; isolation: isolate; }
${selector}::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
${backgroundLists(layers)}
  mask: ${mask ?? "none"};
}`;
}

/**
 * The floating dock: the band behind the composer goes clear (a short fade at
 * its top edge keeps text scrolling under it readable), and the composer box
 * and the cards above it float as translucent panels.
 */
function floatingDock(scope: string, targets: Targets): string {
  const band = `${scope} ${is(targets.dock)}`;
  const panels = `${scope} :is(${is(targets.focusBox)}, ${is(targets.dockCard)})`;
  // A focused composer already wears the focus ring's sticker (stylesheet.ts focusRing).
  const stickered = `${scope}[${STICKERS}="on"] :is(${is(targets.focusBox)}:not(:focus-within), ${is(targets.dockCard)})`;
  return `${band} { background: transparent; }
${band}::before {
  content: "";
  position: absolute;
  inset: auto 0 100% 0;
  height: 28px;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, color-mix(in oklab, var(--lively-canvas) 85%, transparent));
}
${panels} {
  background-color: color-mix(in oklab, var(--lively-panel) 80%, transparent);
  backdrop-filter: blur(12px) saturate(1.2);
  border-color: color-mix(in oklab, var(--lively-accent) 22%, var(--border, transparent));
  box-shadow: 0 14px 32px -16px rgb(0 0 0 / 0.55), 0 2px 6px -2px rgb(0 0 0 / 0.25);
}
${scope} ${is(targets.dockCard)} { --lively-panel: var(--surface-raised-solid, var(--lively-canvas)); }
${stickered} {
  box-shadow: var(--lively-sticker) var(--lively-sticker) 0 color-mix(in oklab, var(--lively-accent) 70%, transparent);
}`;
}

/** One preset's art and fonts. */
function presetArt(preset: Preset, surfaces: Readonly<Record<ArtSurface, string>>, targets: Targets): string {
  const scope = `:root[${ART_ROOT.art}="on"][${ART_ROOT.preset}="${preset.id}"]`;
  const withImage = `:root[${ART_ROOT.art}="on"][${ART_ROOT.artImage}="on"][${ART_ROOT.preset}="${preset.id}"]`;
  const placement = preset.art?.image ?? DEFAULT_IMAGE_PLACEMENT;
  const out: Array<string> = [];
  const fonts = [
    preset.fonts?.sans === undefined ? "" : `  --font-sans: ${preset.fonts.sans};`,
    preset.fonts?.mono === undefined ? "" : `  --font-mono: ${preset.fonts.mono};`,
  ].filter(Boolean);
  if (fonts.length > 0) out.push(`${scope} {\n${fonts.join("\n")}\n}`);
  if (preset.art?.dock === "float") out.push(floatingDock(scope, targets));
  for (const surface of ART_SURFACES) {
    const art = preset.art?.[surface];
    const target = is(surfaces[surface]);
    if (art !== undefined) out.push(surfaceRule(`${scope} ${target}`, art.layers, art.mask));
    if (placement.surface !== surface) continue;
    const wash = `color-mix(in oklab, ${SURFACE_COLOR[surface]} ${Math.round((1 - placement.strength) * 100)}%, transparent)`;
    // The image outweighs the art-only rule (one more attribute) and repeats its layers above the image.
    out.push(
      surfaceRule(
        `${withImage} ${target}`,
        [
          ...(art?.layers ?? []),
          { image: `linear-gradient(${wash}, ${wash})` },
          { image: `var(${ART_IMAGE_PROPERTY})`, size: placement.size, position: placement.position, repeat: "no-repeat" },
        ],
        art?.mask,
      ),
    );
  }
  return out.join("\n");
}

export function buildArtStylesheet(targets: Targets, presets: ReadonlyArray<Preset>): string {
  const surfaces: Record<ArtSurface, string> = { backdrop: targets.pageView, sidebar: targets.sidebar };
  return `/* Preset art (core/src/dom/art.ts): paint only, keyed by the active preset. */
:root[${ART_ROOT.art}="on"] {
  --lively-canvas: var(--canvas, var(--background, Canvas));
  --lively-sidebar: var(--sidebar, var(--lively-canvas));
  --lively-panel: var(--background, var(--lively-canvas));
}
${presets.map((preset) => presetArt(preset, surfaces, targets)).filter(Boolean).join("\n")}
`;
}
