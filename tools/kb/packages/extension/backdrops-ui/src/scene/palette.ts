/**
 * The colours of a scene, derived (never authored): everything comes from the
 * design-system tokens and the head's own colour, so Paper and Terminal paint
 * their own night and day. The silhouette trick rests on one equality: the
 * `body` of every actor IS the page's background tone, so only the light
 * behind it shows where it is.
 */
import { clamp01, lerp } from "./math.ts";

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** What the design system says, as plain colours. */
export interface SceneTokens {
  readonly background: Rgb;
  readonly foreground: Rgb;
  readonly primary: Rgb;
  readonly sun: Rgb;
}

export interface ScenePalette {
  readonly dark: boolean;
  /** The page's background tone: the colour every actor is filled with. */
  readonly body: Rgb;
  /** The light's heart: the moon or the sun. */
  readonly core: Rgb;
  /** The light's far reach, where it fades into the sky. */
  readonly halo: Rgb;
  /** The broad wash behind everything, so an actor away from the light is still faintly there. */
  readonly sky: Rgb;
  /** The thin light on an edge facing the glow. */
  readonly rim: Rgb;
  /** A bat's eye, and its brightest glint. */
  readonly eye: Rgb;
  readonly eyeHot: Rgb;
  /** Stars at night, dust in the sun. */
  readonly mote: Rgb;
  /** A lit window: the one warm thing of a night. */
  readonly window: Rgb;
}

export function mix(from: Rgb, to: Rgb, t: number): Rgb {
  const k = clamp01(t);
  return { r: lerp(from.r, to.r, k), g: lerp(from.g, to.g, k), b: lerp(from.b, to.b, k) };
}

/** Perceptual-enough lightness, 0..1. */
export function lightness({ r, g, b }: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** A canvas / CSS colour string. */
export function css({ r, g, b }: Rgb, alpha = 1): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/** Raise a colour's lightness toward white without losing its hue. */
function lift(color: Rgb, t: number): Rgb {
  return mix(color, { r: 255, g: 255, b: 255 }, t);
}

/**
 * The palette of a scene on `tokens`, lit toward `tint` (the head's colour;
 * null leaves it to the tokens). `dark` is the page's appearance, so night
 * and day each get the light they would: a cool moon, a warm sun.
 */
export function paletteOf(tokens: SceneTokens, tint: Rgb | null, dark: boolean): ScenePalette {
  const body = tokens.background;
  const toward = tint ?? tokens.primary;
  if (dark) {
    const core = lift(mix(tokens.foreground, toward, 0.16), 0.08);
    const halo = mix(mix(body, toward, 0.34), core, 0.18);
    return {
      dark,
      body,
      core,
      halo,
      sky: mix(body, toward, 0.22),
      rim: lift(mix(core, toward, 0.1), 0.15),
      eye: mix(tokens.primary, { r: 255, g: 190, b: 90 }, 0.45),
      eyeHot: lift(mix(tokens.primary, { r: 255, g: 214, b: 130 }, 0.6), 0.35),
      mote: mix(core, body, 0.15),
      window: mix(tokens.primary, { r: 255, g: 196, b: 104 }, 0.5),
    };
  }
  // A pale warm bloom, not a sticker: the sun is light, so its core is the page lit a little gold.
  const core = mix(mix(tokens.sun, body, 0.42), toward, 0.06);
  const halo = mix(mix(body, tokens.sun, 0.4), toward, 0.1);
  return {
    dark,
    body,
    core,
    halo,
    sky: mix(body, mix(tokens.sun, toward, 0.2), 0.2),
    // By day the edge light is deeper gold than the bloom, so a pale body reads round against it.
    rim: mix(core, tokens.sun, 0.7),
    eye: mix(tokens.primary, tokens.foreground, 0.2),
    eyeHot: lift(tokens.sun, 0.4),
    mote: mix(core, body, 0.35),
    window: mix(tokens.sun, { r: 255, g: 150, b: 60 }, 0.4),
  };
}

/** Parse the `rgb(…)` / `rgba(…)` string the token readers answer. */
export function parseRgb(color: string): Rgb | null {
  const match = /rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(color);
  if (match === null) return null;
  const [, r, g, b] = match;
  if (r === undefined || g === undefined || b === undefined) return null;
  return { r: Number(r), g: Number(g), b: Number(b) };
}
