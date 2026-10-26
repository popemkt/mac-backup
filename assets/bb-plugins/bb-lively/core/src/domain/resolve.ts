// The one place a setting's effective value is decided: the explicit value if
// the person set one, else the active preset's, else the base default. Pure;
// every consumer (the policy, the stylesheet's root attributes, a host's
// settings page, the palette switch) reads what this returns.
import { EFFECT_IDS, type EffectId } from "./effects.ts";
import { type Preset, presetById, PRESETS } from "./presets.ts";
import {
  type Choices,
  decodeChoices,
  DEFAULT_SETTINGS,
  FROM_PRESET,
  type PresettableField,
  type Settings,
  type SettingsInput,
  type SettingsProblem,
} from "./settings.ts";

/** Where an effective value came from. */
export type Source = "explicit" | "preset" | "default";

export interface Resolved {
  readonly settings: Settings;
  readonly preset: Preset;
  readonly sources: Readonly<Record<PresettableField, Source>> & { readonly effects: Readonly<Record<EffectId, Source>> };
}

const PRESETTABLE = ["motion", "intensity", "style", "skew", "stickers", "jelly", "speed", "art", "palette"] as const satisfies ReadonlyArray<PresettableField>;

/** Explicit, else the preset's, else the default; and which of the three it was. */
function pick<T>(chosen: T | typeof FROM_PRESET, fromPreset: T | undefined, fallback: T): readonly [T, Source] {
  if (chosen !== FROM_PRESET) return [chosen, "explicit"];
  if (fromPreset !== undefined) return [fromPreset, "preset"];
  return [fallback, "default"];
}

export function resolve(choices: Choices, presets: ReadonlyArray<Preset> = PRESETS): Resolved {
  const preset = presetById(choices.preset, presets);
  const values: Record<string, unknown> = { preset: preset.id, artImage: choices.artImage };
  const sources: Record<string, unknown> = {};
  for (const field of PRESETTABLE) {
    const [value, source] =
      // The palette's one explicit choice, "keep", means no palette rather than a value.
      field === "palette" && choices.palette === "keep"
        ? ([null, "explicit"] as const)
        : pick<unknown>(choices[field], field === "palette" ? preset.palette : preset.values[field], DEFAULT_SETTINGS[field]);
    values[field] = value;
    sources[field] = source;
  }
  const effects: Record<string, boolean> = {};
  const effectSources: Record<string, Source> = {};
  for (const id of EFFECT_IDS) {
    const [value, source] = pick(choices.effects[id], preset.values.effects?.[id], DEFAULT_SETTINGS.effects[id]);
    effects[id] = value;
    effectSources[id] = source;
  }
  return {
    settings: { ...values, effects } as unknown as Settings,
    preset,
    sources: { ...sources, effects: effectSources } as unknown as Resolved["sources"],
  };
}

/** Untrusted input to effective settings: decode the choices, then resolve them against the presets. */
export function decodeSettings(
  input: SettingsInput,
  presets: ReadonlyArray<Preset> = PRESETS,
): Resolved & { readonly choices: Choices; readonly problems: ReadonlyArray<SettingsProblem> } {
  const { choices, problems } = decodeChoices(input);
  return { ...resolve(choices, presets), choices, problems };
}
