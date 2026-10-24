// lively's settings: a motion mode, an intensity, a style and its options, a
// speed, and one switch per effect.
// Decoded from untrusted input (a host's stored values); a missing or invalid
// field takes its default and an invalid one is reported.
import { Result, Schema } from "effect";
import { EFFECT_IDS, EFFECTS, type EffectId } from "./effects.ts";
import { Intensity, Style } from "./motion.ts";

export const MOTION_MODES = ["system", "full", "reduced", "off"] as const;
export const MotionMode = Schema.Literals(MOTION_MODES);
export type MotionMode = typeof MotionMode.Type;

export const SPEEDS = ["snappy", "normal", "relaxed"] as const;
export const Speed = Schema.Literals(SPEEDS);
export type Speed = typeof Speed.Type;

/** How much each speed scales every duration. */
export const SPEED_FACTOR: Readonly<Record<Speed, number>> = { snappy: 0.8, normal: 1, relaxed: 1.25 };

/** When the hard offset "sticker" shadows show: with the wobbly style, with either style, or never. */
export const STICKER_MODES = ["wobbly", "always", "off"] as const;
export const StickerMode = Schema.Literals(STICKER_MODES);
export type StickerMode = typeof StickerMode.Type;

/** The wobbly release's decay: one shared shape (lively's), or matched to each intensity's spring. */
export const JELLY_MODES = ["shared", "matched"] as const;
export const JellyMode = Schema.Literals(JELLY_MODES);
export type JellyMode = typeof JellyMode.Type;

export interface Settings {
  readonly motion: MotionMode;
  readonly intensity: Intensity;
  readonly style: Style;
  /** Wobbly only: arriving rows skew in (composited onto bb's own transform). */
  readonly skew: boolean;
  readonly stickers: StickerMode;
  readonly jelly: JellyMode;
  readonly speed: Speed;
  readonly effects: Readonly<Record<EffectId, boolean>>;
}

export const DEFAULT_SETTINGS: Settings = {
  motion: "system",
  intensity: "bold",
  style: "clean",
  skew: true,
  stickers: "wobbly",
  jelly: "shared",
  speed: "normal",
  effects: Object.fromEntries(EFFECT_IDS.map((id) => [id, EFFECTS[id].default])) as Record<EffectId, boolean>,
};

export interface SettingsInput {
  readonly motion?: unknown;
  readonly intensity?: unknown;
  readonly style?: unknown;
  readonly skew?: unknown;
  readonly stickers?: unknown;
  readonly jelly?: unknown;
  readonly speed?: unknown;
  readonly effects?: Readonly<Partial<Record<string, unknown>>>;
}

export interface SettingsProblem {
  /** A top-level setting's name, or `effects.<id>`. */
  readonly field: string;
  readonly message: string;
}

function decodeField<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  field: string,
  value: unknown,
  fallback: S["Type"],
  problems: Array<SettingsProblem>,
): S["Type"] {
  if (value === undefined) return fallback;
  const decoded = Schema.decodeResult(schema)(value);
  if (Result.isSuccess(decoded)) return decoded.success;
  problems.push({ field, message: decoded.failure.message });
  return fallback;
}

export function decodeSettings(input: SettingsInput): {
  readonly settings: Settings;
  readonly problems: ReadonlyArray<SettingsProblem>;
} {
  const problems: Array<SettingsProblem> = [];
  const effects = Object.fromEntries(
    EFFECT_IDS.map((id) => [
      id,
      decodeField(Schema.Boolean, `effects.${id}`, input.effects?.[id], DEFAULT_SETTINGS.effects[id], problems),
    ]),
  ) as Record<EffectId, boolean>;
  return {
    settings: {
      motion: decodeField(MotionMode, "motion", input.motion, DEFAULT_SETTINGS.motion, problems),
      intensity: decodeField(Intensity, "intensity", input.intensity, DEFAULT_SETTINGS.intensity, problems),
      style: decodeField(Style, "style", input.style, DEFAULT_SETTINGS.style, problems),
      skew: decodeField(Schema.Boolean, "skew", input.skew, DEFAULT_SETTINGS.skew, problems),
      stickers: decodeField(StickerMode, "stickers", input.stickers, DEFAULT_SETTINGS.stickers, problems),
      jelly: decodeField(JellyMode, "jelly", input.jelly, DEFAULT_SETTINGS.jelly, problems),
      speed: decodeField(Speed, "speed", input.speed, DEFAULT_SETTINGS.speed, problems),
      effects,
    },
    problems,
  };
}
