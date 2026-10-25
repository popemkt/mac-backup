// The presets' art layer as CSS: per preset, the backdrop and sidebar art
// (domain/presets.ts), its named colors and its font tokens, all under
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
import { cssString } from "./css.ts";
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

/** The color each surface's wash fades the person's image toward: what is painted behind it. */
const SURFACE_COLOR: Readonly<Record<ArtSurface, string>> = {
  backdrop: "var(--lively-canvas)",
  sidebar: "var(--lively-sidebar)",
};

const is = (selector: string) => `:is(${selector})`;

/** Layers as the background lists (image, size, position, repeat, attachment). */
function backgroundLists(layers: ReadonlyArray<ArtLayer>): string {
  const list = (pick: (layer: ArtLayer) => string) => layers.map(pick).join(", ");
  return `  background-image: ${list((layer) => layer.image)};
  background-size: ${list((layer) => layer.size ?? "auto")};
  background-position: ${list((layer) => layer.position ?? "0 0")};
  background-repeat: ${list((layer) => layer.repeat ?? "repeat")};
  background-attachment: ${list((layer) => layer.attachment ?? "scroll")};`;
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
  const colors = Object.entries(preset.art?.colors ?? {}).map(([name, color]) => `  --lively-c-${name}: ${color};`);
  if (fonts.length + colors.length > 0) out.push(`${scope} {\n${[...fonts, ...colors].join("\n")}\n}`);
  // With a backdrop, bb's dock band (opaque, behind the composer) repeats it: the art is
  // anchored to the corner they share, so it runs to the bottom edge without a seam. bb's
  // fade above the band, a solid gradient, would cut it off, so it goes.
  // The person's image behind the thread does the same.
  // The dock's controls then float on the art, each on its own rounded surface, with no hard
  // offset shadow: the palette's lift (ZZZ's is a 4px black offset) and lively's focus sticker
  // would cut a dark sliver into the art past the composer's rounded edge.
  const behindThread = `${surfaces.backdrop}, ${targets.dock}`;
  const overArt = [preset.art?.backdrop !== undefined ? scope : "", placement.surface === "backdrop" ? withImage : ""];
  for (const root of overArt.filter(Boolean)) {
    out.push(`${root} ${is(targets.dockFade)} { display: none; }
${root} ${is(targets.focusBox)} { --shadow-lift: 0 0 #0000; --lively-sticker: 0px; }`);
  }
  // The preset's caption down the sidebar's inner edge (its gutter, clear of the rows), in its lettering (the stylesheet's
  // --lively-letter-* properties): art, so it goes with the art switch.
  const caption = preset.lettering?.sidebar;
  if (caption !== undefined) {
    out.push(`${scope} ${is(targets.sidebar)} { position: relative; isolation: isolate; }
${scope} ${is(targets.sidebar)}::after {
  content: ${cssString(caption)};
  position: absolute;
  top: 120px;
  right: 2px;
  writing-mode: vertical-rl;
  pointer-events: none;
  font: 600 9px/1 var(--lively-letter-font);
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--lively-letter-color);
  opacity: 0.8;
}`);
  }
  for (const surface of ART_SURFACES) {
    const art = preset.art?.[surface];
    const target = is(surface === "backdrop" ? behindThread : surfaces[surface]);
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
          // Fixed to the window, so the thread and the dock band show one picture.
          { image: `var(${ART_IMAGE_PROPERTY})`, size: placement.size, position: placement.position, repeat: "no-repeat", attachment: "fixed" },
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
}
${presets.map((preset) => presetArt(preset, surfaces, targets)).filter(Boolean).join("\n")}
`;
}
