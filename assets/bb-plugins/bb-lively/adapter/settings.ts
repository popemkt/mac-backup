// lively's plugin settings: the one table that both declares them to bb
// (server.ts) and reads them back into the core's settings (app.tsx).
import type { PluginSettingDescriptor } from "@get-bb/plugin-sdk";
import { Schema } from "effect";
import {
  DEFAULT_SETTINGS,
  EFFECT_IDS,
  EFFECTS,
  type EffectId,
  INTENSITIES,
  Intensity,
  JELLY_MODES,
  JellyMode,
  MOTION_MODES,
  MotionMode,
  type SettingsInput,
  Speed,
  SPEEDS,
  STICKER_MODES,
  StickerMode,
  Style,
  STYLES,
} from "@popemkt/bb-lively-core/domain";

/**
 * An Effect schema as the plain Standard Schema object bb's settings accept.
 * bb checks `typeof value === "object"`, and an Effect schema is a function,
 * so its `~standard` property is lifted onto an object of its own.
 */
const standard = <S extends { readonly "~standard": unknown }>(schema: S): Pick<S, "~standard"> => ({
  "~standard": schema["~standard"],
});

/** An effect's description: what it does, its wobbly variant, and whether it survives reduced motion. */
function effectDescription(id: EffectId): string {
  const { description, wobbly, reducedSafe } = EFFECTS[id];
  const parts = [description];
  if (wobbly !== "Unchanged." && wobbly !== "The same under either style.") parts.push(`Wobbly: ${wobbly}`);
  if (!reducedSafe) parts.push("Off under reduced motion.");
  return parts.join(" ");
}

const effectDescriptors = Object.fromEntries(
  EFFECT_IDS.map((id) => [
    id,
    {
      type: "boolean",
      label: EFFECTS[id].label,
      description: effectDescription(id),
      default: EFFECTS[id].default,
      experimental_schema: standard(Schema.toStandardSchemaV1(Schema.Boolean)),
    } satisfies PluginSettingDescriptor,
  ]),
) as Record<EffectId, PluginSettingDescriptor & { type: "boolean"; default: boolean }>;

export const SETTINGS = {
  motion: {
    type: "select",
    label: "Motion",
    description:
      "System follows your OS \"reduce motion\" setting. Reduced keeps only short fades (no movement, no bounce), so changes stay visible. Off turns every effect off.",
    options: [...MOTION_MODES],
    experimental_optionLabels: { system: "System", full: "Full", reduced: "Reduced", off: "Off" },
    default: DEFAULT_SETTINGS.motion,
    experimental_schema: standard(Schema.toStandardSchemaV1(MotionMode)),
  },
  intensity: {
    type: "select",
    label: "Intensity",
    description:
      "One volume for every effect: how far things travel, how much they bounce, how long they take, how strongly they glow. Subtle is quiet and quick; Bold is expressive (springier overshoot, blur-in, a send burst, breathing glows). Reduced motion collapses every level to short fades.",
    options: [...INTENSITIES],
    experimental_optionLabels: { subtle: "Subtle", lively: "Lively", bold: "Bold" },
    default: DEFAULT_SETTINGS.intensity,
    experimental_schema: standard(Schema.toStandardSchemaV1(Intensity)),
  },
  style: {
    type: "select",
    label: "Style",
    description:
      "The shape of the motion, at any intensity. Clean: one soft overshoot, then rest. Wobbly (after Zenless Zone Zero): a snap in, then two or three bounces, with squash on press, jelly on release, rows skewing in, tilts, a brightness flash and a chromatic split. Lively suits wobbly better than Bold for all-day use. Reduced motion turns both into the same short fades.",
    options: [...STYLES],
    experimental_optionLabels: { clean: "Clean", wobbly: "Wobbly" },
    default: DEFAULT_SETTINGS.style,
    experimental_schema: standard(Schema.toStandardSchemaV1(Style)),
  },
  skew: {
    type: "boolean",
    label: "Skew (wobbly)",
    description:
      "Arriving messages skew in and straighten as they land, the diagonal energy of ZZZ's panels. Composited onto bb's own row positioning; never applied to toasts. Off keeps the rest of wobbly.",
    default: DEFAULT_SETTINGS.skew,
    experimental_schema: standard(Schema.toStandardSchemaV1(Schema.Boolean)),
  },
  stickers: {
    type: "select",
    label: "Sticker shadows",
    description:
      "Hard offset shadows, like stickers: they snap in under hovered cards and sit under menus, toasts and the focused composer. With wobbly (the default), with either style, or never. A shadow is not motion, so it stays under reduced motion.",
    options: [...STICKER_MODES],
    experimental_optionLabels: { wobbly: "With wobbly", always: "Always", off: "Off" },
    default: DEFAULT_SETTINGS.stickers,
    experimental_schema: standard(Schema.toStandardSchemaV1(StickerMode)),
  },
  jelly: {
    type: "select",
    label: "Jelly decay (wobbly)",
    description:
      "How a wobbly release settles. Shared: one jelly shape at every intensity (the squash still scales). Matched: each intensity's jelly decays like its own spring, so Bold wobbles longer and Subtle settles sooner.",
    options: [...JELLY_MODES],
    experimental_optionLabels: { shared: "Shared", matched: "Matched" },
    default: DEFAULT_SETTINGS.jelly,
    experimental_schema: standard(Schema.toStandardSchemaV1(JellyMode)),
  },
  speed: {
    type: "select",
    label: "Speed",
    description: "Scales every duration: snappy is 0.8×, relaxed 1.25×.",
    options: [...SPEEDS],
    experimental_optionLabels: { snappy: "Snappy", normal: "Normal", relaxed: "Relaxed" },
    default: DEFAULT_SETTINGS.speed,
    experimental_schema: standard(Schema.toStandardSchemaV1(Speed)),
  },
  ...effectDescriptors,
} satisfies Record<string, PluginSettingDescriptor>;

/** bb's settings values (untrusted: they round-trip through storage) as core settings input. */
export function settingsInput(values: Readonly<Record<string, unknown>>): SettingsInput {
  return {
    motion: values["motion"],
    intensity: values["intensity"],
    style: values["style"],
    skew: values["skew"],
    stickers: values["stickers"],
    jelly: values["jelly"],
    speed: values["speed"],
    effects: Object.fromEntries(EFFECT_IDS.map((id) => [id, values[id]])),
  };
}
