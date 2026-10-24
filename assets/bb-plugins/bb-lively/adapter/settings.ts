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
  MOTION_MODES,
  MotionMode,
  type SettingsInput,
  Speed,
  SPEEDS,
} from "@popemkt/bb-lively-core/domain";

/**
 * An Effect schema as the plain Standard Schema object bb's settings accept.
 * bb checks `typeof value === "object"`, and an Effect schema is a function,
 * so its `~standard` property is lifted onto an object of its own.
 */
const standard = <S extends { readonly "~standard": unknown }>(schema: S): Pick<S, "~standard"> => ({
  "~standard": schema["~standard"],
});

const effectDescriptors = Object.fromEntries(
  EFFECT_IDS.map((id) => [
    id,
    {
      type: "boolean",
      label: EFFECTS[id].label,
      description: EFFECTS[id].reducedSafe
        ? EFFECTS[id].description
        : `${EFFECTS[id].description} Off under reduced motion.`,
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
    speed: values["speed"],
    effects: Object.fromEntries(EFFECT_IDS.map((id) => [id, values[id]])),
  };
}
