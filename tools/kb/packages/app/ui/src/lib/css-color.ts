/**
 * Token colors, normalized to a form every renderer can parse.
 *
 * The palette is authored in oklch (`design-system.css`), and Chrome's computed
 * value for `color` preserves the authored color space rather than converting
 * to rgb. Canvas and GPU consumers (sigma's colour parser, three's `Color`,
 * the `alpha` option below) read only hex and `rgb()`/`rgba()`; an oklch
 * value would be dropped or thrown on.
 *
 * So this module always hands back `rgb()`/`rgba()` with integer channels.
 */

const CHANNEL = String.raw`-?[\d.]+%?`;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** sRGB transfer function (linear-light → encoded). */
function gammaEncode(channel: number): number {
  const c = clamp01(channel);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

function toByte(channel: number): number {
  return Math.round(gammaEncode(channel) * 255);
}

/** A single oklch component: plain number, or percentage of `full`. */
function component(raw: string, full: number): number {
  const trimmed = raw.trim();
  if (trimmed === "none") return 0;
  const value = Number.parseFloat(trimmed);
  if (Number.isNaN(value)) return Number.NaN;
  return trimmed.endsWith("%") ? (value / 100) * full : value;
}

/**
 * oklch → sRGB (Ottosson's oklab matrices). Returns null when the string is not
 * parseable oklch, so callers can fall through to their own handling.
 */
export function oklchToRgb(
  color: string,
): { r: number; g: number; b: number; alpha: number } | null {
  const match = new RegExp(
    String.raw`^oklch\(\s*(${CHANNEL}|none)\s+(${CHANNEL}|none)\s+(${CHANNEL}|none)\s*(?:\/\s*(${CHANNEL}|none)\s*)?\)$`,
    "i",
  ).exec(color.trim());
  if (!match) return null;

  const [, lightnessRaw, chromaRaw, hueGroup] = match;
  if (lightnessRaw === undefined || chromaRaw === undefined || hueGroup === undefined) return null;
  const lightness = component(lightnessRaw, 1);
  const chroma = component(chromaRaw, 0.4);
  const hueRaw = hueGroup.trim();
  const hue = hueRaw === "none" ? 0 : Number.parseFloat(hueRaw);
  const alphaRaw = match[4];
  const alpha = alphaRaw === undefined ? 1 : component(alphaRaw, 1);
  if ([lightness, chroma, hue, alpha].some(Number.isNaN)) return null;

  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  // oklab → LMS (cube each) → linear sRGB.
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: toByte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toByte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha: clamp01(alpha),
  };
}

function parseHex(color: string): { r: number; g: number; b: number } | null {
  const hex = /^#([a-f\d]{3}|[a-f\d]{6})$/i.exec(color.trim());
  if (!hex) return null;
  const [, digits] = hex;
  if (digits === undefined) return null;
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((d) => d + d)
          .join("")
      : digits;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function parseRgb(color: string): { r: number; g: number; b: number; alpha: number } | null {
  const match = new RegExp(
    String.raw`^rgba?\(\s*(${CHANNEL})[\s,]+(${CHANNEL})[\s,]+(${CHANNEL})\s*(?:[,/]\s*(${CHANNEL})\s*)?\)$`,
    "i",
  ).exec(color.trim());
  if (!match) return null;
  const channel = (raw: string) => component(raw, 255);
  const alphaRaw = match[4];
  const alpha = alphaRaw === undefined ? 1 : component(alphaRaw, 1);
  const [, rRaw, gRaw, bRaw] = match;
  if (rRaw === undefined || gRaw === undefined || bRaw === undefined) return null;
  const parsed = {
    r: Math.round(channel(rRaw)),
    g: Math.round(channel(gRaw)),
    b: Math.round(channel(bRaw)),
    alpha: clamp01(alpha),
  };
  return Object.values(parsed).some(Number.isNaN) ? null : parsed;
}

/**
 * Normalize any color this app authors into `rgb()`/`rgba()` with integer
 * channels. Returns null for formats we do not handle, so the caller keeps
 * control of its own fallback.
 */
export function toRenderableColor(color: string, alphaOverride?: number): string | null {
  const parsed =
    oklchToRgb(color) ??
    parseRgb(color) ??
    (() => {
      const hex = parseHex(color);
      return hex ? { ...hex, alpha: 1 } : null;
    })();
  if (!parsed) return null;
  const alpha = clamp01(alphaOverride ?? parsed.alpha);
  return alpha >= 1
    ? `rgb(${parsed.r}, ${parsed.g}, ${parsed.b})`
    : `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`;
}

/**
 * The palette tokens canvas renderers read, each with the colour it stands
 * for when there is no document to resolve it against (unit tests, SSR).
 * The fallback belongs to the token, not to whichever caller reads it.
 */
const TOKEN_FALLBACK = {
  "--foreground": "#222",
  "--background": "#fff",
  "--card": "#fff",
  "--muted": "#f5f5f5",
  "--muted-foreground": "#737373",
  "--primary": "#c27c0e",
  "--graph-edge": "rgba(34, 34, 34, 0.4)",
  // The lab palette: mid grey, so a missing token reads as missing rather
  // than as a deliberate colour.
  "--lab-ground": "rgb(128, 128, 128)",
  "--lab-edge": "rgb(128, 128, 128)",
  "--lab-hue": "rgb(128, 128, 128)",
  "--lab-ink": "rgb(128, 128, 128)",
  "--lab-accent": "rgb(128, 128, 128)",
} as const;

export type ColorToken = keyof typeof TOKEN_FALLBACK;

/** Every token a renderer may read, with its fallback; `css-color.test.ts` binds each to the stylesheets. */
export const COLOR_TOKEN_FALLBACKS: Readonly<Record<ColorToken, string>> = TOKEN_FALLBACK;

export function readTokenColor(varName: ColorToken, opts: { alpha?: number } = {}): string {
  const fallback = TOKEN_FALLBACK[varName];
  const unresolved = toRenderableColor(fallback, opts.alpha) ?? fallback;
  if (typeof document === "undefined") return unresolved;
  const probe = document.createElement("span");
  probe.style.color = `var(${varName})`;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.documentElement.appendChild(probe);
  const raw = getComputedStyle(probe).color;
  document.documentElement.removeChild(probe);
  // A token in any authored space becomes rgb/rgba here, so downstream parsers
  // (notably `polished`, via three-render-objects) never see oklch.
  return (raw.length > 0 ? toRenderableColor(raw, opts.alpha) : null) ?? unresolved;
}
