/**
 * Token colors, normalized to a form every renderer can parse.
 *
 * The token system is authored in oklch (`tokens.css`), and Chrome's computed
 * value for `color` preserves the authored color space rather than converting
 * to rgb. That breaks two consumers:
 *
 *   - `3d-force-graph` → `three-render-objects` parses colors with `polished`,
 *     which accepts only hex/rgb/rgba/hsl/hsla and throws on anything else.
 *     An oklch background made the whole 3D scene fail to initialize.
 *   - the `alpha` option below, whose regex only ever matched `rgb()`/`rgba()`,
 *     so every `alpha` request against an oklch token was silently dropped and
 *     edges/labels rendered at full opacity.
 *
 * So this module always hands back `rgb()`/`rgba()` with integer channels —
 * `polished`'s rgb pattern rejects fractional ones.
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

  const lightness = component(match[1]!, 1);
  const chroma = component(match[2]!, 0.4);
  const hueRaw = match[3]!.trim();
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
  const digits = hex[1]!;
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

function parseRgb(
  color: string,
): { r: number; g: number; b: number; alpha: number } | null {
  const match = new RegExp(
    String.raw`^rgba?\(\s*(${CHANNEL})[\s,]+(${CHANNEL})[\s,]+(${CHANNEL})\s*(?:[,/]\s*(${CHANNEL})\s*)?\)$`,
    "i",
  ).exec(color.trim());
  if (!match) return null;
  const channel = (raw: string) => component(raw, 255);
  const alphaRaw = match[4];
  const alpha = alphaRaw === undefined ? 1 : component(alphaRaw, 1);
  const parsed = {
    r: Math.round(channel(match[1]!)),
    g: Math.round(channel(match[2]!)),
    b: Math.round(channel(match[3]!)),
    alpha: clamp01(alpha),
  };
  return Object.values(parsed).some(Number.isNaN) ? null : parsed;
}

/**
 * Normalize any color this app authors into `rgb()`/`rgba()` with integer
 * channels. Returns null for formats we do not handle, so the caller keeps
 * control of its own fallback.
 */
export function toRenderableColor(
  color: string,
  alphaOverride?: number,
): string | null {
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

export function readTokenColor(
  varName: string,
  opts: { alpha?: number; fallback: string } = { fallback: "rgb(0, 0, 0)" },
): string {
  if (typeof document === "undefined") return opts.fallback;
  const probe = document.createElement("span");
  probe.style.color = `var(${varName})`;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.documentElement.appendChild(probe);
  const raw = getComputedStyle(probe).color;
  document.documentElement.removeChild(probe);
  if (!raw) return opts.fallback;
  // A token in any authored space becomes rgb/rgba here, so downstream parsers
  // (notably `polished`, via three-render-objects) never see oklch.
  return (
    toRenderableColor(raw, opts.alpha) ??
    toRenderableColor(opts.fallback, opts.alpha) ??
    opts.fallback
  );
}

/**
 * Rule behind `3b1f82f`: every colour crossing into the 3D renderer MUST be
 * hex or rgb/rgba — polished throws on oklch and blanks the scene.
 */
export const FORCE3D_SAFE_COLOR = /^(#|rgba?\()/i;

export function isForce3dSafeColor(color: string): boolean {
  return FORCE3D_SAFE_COLOR.test(color.trim());
}

/** Normalize + assert a colour is safe for 3d-force-graph / polished. */
export function force3dColor(
  color: string,
  fallback = "rgb(128, 128, 128)",
): string {
  const rendered = toRenderableColor(color) ?? toRenderableColor(fallback) ?? fallback;
  if (!isForce3dSafeColor(rendered)) {
    throw new Error(
      `force3dColor: refused unsafe colour "${rendered}" (from "${color}")`,
    );
  }
  return rendered;
}

