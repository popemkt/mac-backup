// lively's settings: a preset, a motion mode, an intensity, a style and its
// options, a speed, the art layer, a palette policy, and one switch per effect.
//
// Two shapes:
// - `Choices` is what a person set: every presettable field is either an
//   explicit value or `"preset"` (follow the active preset). Decoded from
//   untrusted input (a host's stored values); a missing or invalid field is
//   `"preset"`, and an invalid one is reported.
// - `Settings` is the effective value of every field, after `resolve`
//   (resolve.ts): the explicit value, else the preset's, else the base
//   default below. Every consumer reads `Settings` only.
import { Result, Schema } from "effect";
import { EFFECT_IDS, EFFECTS, type EffectId } from "./effects.ts";
import { Intensity, Style } from "./motion.ts";
import { PRESET_IDS, PresetId } from "./presets.ts";

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

/** The choice that follows the active preset: every presettable field's default. */
export const FROM_PRESET = "preset";
export type FromPreset = typeof FROM_PRESET;

/** The effective settings: what runs. */
export interface Settings {
  /** The active preset's id (presets.ts); its values fill every field still `"preset"`. */
  readonly preset: string;
  readonly motion: MotionMode;
  readonly intensity: Intensity;
  readonly style: Style;
  /** Wobbly only: arriving rows skew in (composited onto bb's own transform). */
  readonly skew: boolean;
  readonly stickers: StickerMode;
  readonly jelly: JellyMode;
  readonly speed: Speed;
  /** The preset's art layer (backdrops, fonts) and the person's own art image show. */
  readonly art: boolean;
  /** The host palette (theme) id to switch to, or null to leave the host's theme alone. */
  readonly palette: string | null;
  /** A URL (absolute, or root-relative on the host's origin) of the person's own art image; "" for none. */
  readonly artImage: string;
  readonly effects: Readonly<Record<EffectId, boolean>>;
}

/** The base defaults: what a field is when neither the person nor the preset sets it. */
export const DEFAULT_SETTINGS: Settings = {
  preset: PRESET_IDS[0],
  motion: "system",
  intensity: "bold",
  style: "clean",
  skew: true,
  stickers: "wobbly",
  jelly: "shared",
  speed: "normal",
  art: true,
  palette: null,
  artImage: "",
  effects: Object.fromEntries(EFFECT_IDS.map((id) => [id, EFFECTS[id].default])) as Record<EffectId, boolean>,
};

/** A presettable field's choice: an explicit value, or follow the preset. */
export type Choice<T> = T | FromPreset;

/** What a person set (see the header). */
export interface Choices {
  /** A preset id; decoding admits only the rows of PRESETS. */
  readonly preset: string;
  readonly motion: Choice<MotionMode>;
  readonly intensity: Choice<Intensity>;
  readonly style: Choice<Style>;
  readonly skew: Choice<boolean>;
  readonly stickers: Choice<StickerMode>;
  readonly jelly: Choice<JellyMode>;
  readonly speed: Choice<Speed>;
  readonly art: Choice<boolean>;
  /** `keep` never touches the host's theme; `preset` switches to the preset's palette, if it names one. */
  readonly palette: Choice<"keep">;
  readonly artImage: string;
  readonly effects: Readonly<Record<EffectId, Choice<boolean>>>;
}

/** The fields a preset can set: everything but the preset itself and the person's own image. */
export type PresettableField = Exclude<keyof Choices, "preset" | "artImage" | "effects">;

export const NO_CHOICES: Choices = {
  preset: DEFAULT_SETTINGS.preset,
  motion: FROM_PRESET,
  intensity: FROM_PRESET,
  style: FROM_PRESET,
  skew: FROM_PRESET,
  stickers: FROM_PRESET,
  jelly: FROM_PRESET,
  speed: FROM_PRESET,
  art: FROM_PRESET,
  palette: FROM_PRESET,
  artImage: "",
  effects: Object.fromEntries(EFFECT_IDS.map((id) => [id, FROM_PRESET])) as Record<EffectId, FromPreset>,
};

export interface SettingsInput {
  readonly preset?: unknown;
  readonly motion?: unknown;
  readonly intensity?: unknown;
  readonly style?: unknown;
  readonly skew?: unknown;
  readonly stickers?: unknown;
  readonly jelly?: unknown;
  readonly speed?: unknown;
  readonly art?: unknown;
  readonly palette?: unknown;
  readonly artImage?: unknown;
  readonly effects?: Readonly<Partial<Record<string, unknown>>>;
}

export interface SettingsProblem {
  /** A top-level setting's name, or `effects.<id>`. */
  readonly field: string;
  readonly message: string;
}

/** An art image URL lively will put inside `url("…")`: http(s), or a root-relative path; never a quote, backslash or control character. */
export const ArtImage = Schema.String.check(
  Schema.makeFilter((value: string) => {
    if (value === "") return undefined;
    let unsafe = false;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code < 0x20 || code === 0x7f || code === 0x22 || code === 0x5c) unsafe = true;
    }
    return /^(?:https?:\/\/|\/)/u.test(value) && !unsafe
      ? undefined
      : "an http(s) URL or a root-relative path, without quotes, backslashes or control characters";
  }),
);

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

/** A presettable field: its own schema, or `"preset"`. */
const choice = <S extends Schema.Constraint>(schema: S) => Schema.Union([Schema.Literal(FROM_PRESET), schema]);

export function decodeChoices(input: SettingsInput): {
  readonly choices: Choices;
  readonly problems: ReadonlyArray<SettingsProblem>;
} {
  const problems: Array<SettingsProblem> = [];
  const Toggle = choice(Schema.Boolean);
  const effects = Object.fromEntries(
    EFFECT_IDS.map((id) => [id, decodeField(Toggle, `effects.${id}`, input.effects?.[id], FROM_PRESET, problems)]),
  ) as Record<EffectId, Choice<boolean>>;
  return {
    choices: {
      preset: decodeField(PresetId, "preset", input.preset, PRESET_IDS[0], problems),
      motion: decodeField(choice(MotionMode), "motion", input.motion, FROM_PRESET, problems),
      intensity: decodeField(choice(Intensity), "intensity", input.intensity, FROM_PRESET, problems),
      style: decodeField(choice(Style), "style", input.style, FROM_PRESET, problems),
      skew: decodeField(Toggle, "skew", input.skew, FROM_PRESET, problems),
      stickers: decodeField(choice(StickerMode), "stickers", input.stickers, FROM_PRESET, problems),
      jelly: decodeField(choice(JellyMode), "jelly", input.jelly, FROM_PRESET, problems),
      speed: decodeField(choice(Speed), "speed", input.speed, FROM_PRESET, problems),
      art: decodeField(Toggle, "art", input.art, FROM_PRESET, problems),
      palette: decodeField(choice(Schema.Literal("keep")), "palette", input.palette, FROM_PRESET, problems),
      artImage: decodeField(ArtImage, "artImage", input.artImage, "", problems),
      effects,
    },
    problems,
  };
}
