// lively's plugin settings: the one table that both declares them to bb
// (server.ts) and reads them back into the core's settings (app.tsx).
//
// Presets (core/src/domain/presets.ts) set many settings at once, and a
// person can still set any one of them. bb's settings have no "unset" a
// person can pick and a boolean is a plain switch, so every presettable
// setting is a select whose first option, and default, is "From preset";
// switches become From preset / On / Off. The effective value is the explicit
// one, else the preset's, else the base default (core `resolve`); the
// settings page's Preset section shows each effective value and where it
// came from, since a descriptor's description cannot change at runtime.
// GAP [[01M5RXXJV7Q5EWQF8EVK8VFX85]]: bb plugin settings cannot inherit a value or describe it live.
import type { PluginSettingDescriptor } from "@get-bb/plugin-sdk";
import { Schema } from "effect";
import {
  decodeSettings,
  DEFAULT_SETTINGS,
  EFFECT_IDS,
  EFFECTS,
  type EffectId,
  FROM_PRESET,
  INTENSITIES,
  JELLY_MODES,
  MOTION_MODES,
  PRESET_IDS,
  PRESETS,
  type PresettableField,
  type Resolved,
  type SettingsInput,
  SPEEDS,
  STICKER_MODES,
  STYLES,
} from "@popemkt/bb-lively-core/domain";

/** The plugin id bb gives lively (manifest name `bb-plugin-bb-lively`): its HTTP routes and theme ids live under it. */
export const PLUGIN_ID = "bb-lively";

/** Where server.ts serves the person's art image when it is a file on the bb host. */
export const ART_ROUTE = "/art";

/**
 * An Effect schema as the plain Standard Schema object bb's settings accept.
 * bb checks `typeof value === "object"`, and an Effect schema is a function,
 * so its `~standard` property is lifted onto an object of its own.
 */
const standard = <S extends { readonly "~standard": unknown }>(schema: S): Pick<S, "~standard"> => ({
  "~standard": schema["~standard"],
});

const FROM_PRESET_LABEL = "From preset";
const TOGGLE = [FROM_PRESET, "on", "off"] as const;
const TOGGLE_LABELS = { [FROM_PRESET]: FROM_PRESET_LABEL, on: "On", off: "Off" };

/** A presettable select: "From preset" first (the default), then the setting's own options. */
function presettable(
  field: Exclude<PresettableField, "palette" | "skew" | "art">,
  options: ReadonlyArray<string>,
  labels: Readonly<Record<string, string>>,
  label: string,
  description: string,
) {
  const all = [FROM_PRESET, ...options];
  const base = DEFAULT_SETTINGS[field];
  return {
    type: "select",
    label,
    description: `${description} Without a preset: ${labels[base] ?? base}.`,
    options: all,
    experimental_optionLabels: { [FROM_PRESET]: FROM_PRESET_LABEL, ...labels },
    default: FROM_PRESET,
    experimental_schema: standard(Schema.toStandardSchemaV1(Schema.Literals(all))),
  } satisfies PluginSettingDescriptor;
}

/** A presettable switch: From preset, On, Off. */
function toggle(label: string, description: string, base: boolean) {
  return {
    type: "select",
    label,
    description: `${description} Without a preset: ${base ? "on" : "off"}.`,
    options: [...TOGGLE],
    experimental_optionLabels: TOGGLE_LABELS,
    default: FROM_PRESET,
    experimental_schema: standard(Schema.toStandardSchemaV1(Schema.Literals(TOGGLE))),
  } satisfies PluginSettingDescriptor;
}

/** An effect's description: what it does, its wobbly variant, and whether it survives reduced motion. */
function effectDescription(id: EffectId): string {
  const { description, wobbly, reducedSafe } = EFFECTS[id];
  const parts = [description];
  if (wobbly !== "Unchanged." && wobbly !== "The same under either style.") parts.push(`Wobbly: ${wobbly}`);
  if (!reducedSafe) parts.push("Off under reduced motion.");
  return parts.join(" ");
}

const effectDescriptors = Object.fromEntries(
  EFFECT_IDS.map((id) => [id, toggle(EFFECTS[id].label, effectDescription(id), EFFECTS[id].default)]),
) as Record<EffectId, ReturnType<typeof toggle>>;

/** The person's art image as typed: an http(s) URL, or an absolute (or `~/`) path to an image file on the bb host. */
const ArtImageInput = Schema.String.check(
  Schema.makeFilter((value: string) =>
    value === "" || /^(?:https?:\/\/|\/|~\/)/u.test(value) ? undefined : "an http(s) URL, or an absolute or ~/ path on the bb host",
  ),
);

const presetLabels = Object.fromEntries(PRESETS.map((preset) => [preset.id, preset.label]));

export const SETTINGS = {
  preset: {
    type: "select",
    label: "Preset",
    description: `One art direction in one setting: motion, style, effects, bb's palette and an art layer together. Every setting below left on "From preset" follows it; any you set yourself stay as you set them when you switch presets. ${PRESETS.slice(1)
      .map((preset) => `${preset.label}: ${preset.description}`)
      .join(" ")}`,
    options: [...PRESET_IDS],
    experimental_optionLabels: presetLabels,
    default: PRESET_IDS[0],
    experimental_schema: standard(Schema.toStandardSchemaV1(Schema.Literals(PRESET_IDS))),
  },
  motion: presettable(
    "motion",
    MOTION_MODES,
    { system: "System", full: "Full", reduced: "Reduced", off: "Off" },
    "Motion",
    "System follows your OS \"reduce motion\" setting. Reduced keeps only short fades (no movement, no bounce), so changes stay visible. Off turns every effect, and the art, off.",
  ),
  intensity: presettable(
    "intensity",
    INTENSITIES,
    { subtle: "Subtle", lively: "Lively", bold: "Bold" },
    "Intensity",
    "One volume for every effect: how far things travel, how much they bounce, how long they take, how strongly they glow. Subtle is quiet and quick; Bold is expressive (springier overshoot, blur-in, a send burst, breathing glows). Reduced motion collapses every level to short fades.",
  ),
  style: presettable(
    "style",
    STYLES,
    { clean: "Clean", wobbly: "Wobbly" },
    "Style",
    "The shape of the motion, at any intensity. Clean: one soft overshoot, then rest. Wobbly (after Zenless Zone Zero): a snap in, then two or three bounces, with squash on press, jelly on release, rows skewing in, tilts, a brightness flash and a chromatic split. Reduced motion turns both into the same short fades.",
  ),
  skew: toggle(
    "Skew (wobbly)",
    "Arriving messages skew in and straighten as they land, the diagonal energy of ZZZ's panels. Composited onto bb's own row positioning; never applied to toasts. Off keeps the rest of wobbly.",
    DEFAULT_SETTINGS.skew,
  ),
  stickers: presettable(
    "stickers",
    STICKER_MODES,
    { wobbly: "With wobbly", always: "Always", off: "Off" },
    "Sticker shadows",
    "Hard offset shadows, like stickers: they snap in under hovered cards and sit under menus, toasts and the focused composer. A shadow is not motion, so it stays under reduced motion.",
  ),
  jelly: presettable(
    "jelly",
    JELLY_MODES,
    { shared: "Shared", matched: "Matched" },
    "Jelly decay (wobbly)",
    "How a wobbly release settles. Shared: one jelly shape at every intensity (the squash still scales). Matched: each intensity's jelly decays like its own spring, so Bold wobbles longer and Subtle settles sooner.",
  ),
  speed: presettable("speed", SPEEDS, { snappy: "Snappy", normal: "Normal", relaxed: "Relaxed" }, "Speed", "Scales every duration: snappy is 0.8×, relaxed 1.25×."),
  palette: {
    type: "select",
    label: "Palette",
    description:
      "From preset: picking a preset that names a palette switches bb's theme to it (Settings → Appearance), and picking one that does not puts back the theme you had. Keep my bb theme: presets never touch bb's theme.",
    options: [FROM_PRESET, "keep"],
    experimental_optionLabels: { [FROM_PRESET]: FROM_PRESET_LABEL, keep: "Keep my bb theme" },
    default: FROM_PRESET,
    experimental_schema: standard(Schema.toStandardSchemaV1(Schema.Literals([FROM_PRESET, "keep"]))),
  },
  art: toggle(
    "Art",
    "The preset's art layer: a backdrop behind the open thread and the sidebar, and its fonts, plus your own art image. Paint, not motion: it stays under reduced motion.",
    DEFAULT_SETTINGS.art,
  ),
  artImage: {
    type: "string",
    label: "Art image",
    description:
      "Your own picture for the art layer: an https URL, or the path of an image file on the machine bb runs on (absolute or ~/; png, jpg, webp, gif, avif or svg), served by lively to this window only. Kept out of any repository. The preset chooses where it goes (behind the thread by default) and washes it out so text stays readable. Empty: the preset's own art alone.",
    default: "",
    experimental_schema: standard(Schema.toStandardSchemaV1(ArtImageInput)),
  },
  ...effectDescriptors,
} satisfies Record<string, PluginSettingDescriptor>;

/** The art image as a URL the window can load: a URL as is, a file on the bb host through lively's art route. */
export function artImageUrl(value: unknown): unknown {
  if (typeof value !== "string" || value === "" || /^https?:\/\//u.test(value)) return value;
  return `/api/v1/plugins/${PLUGIN_ID}/http${ART_ROUTE}?v=${encodeURIComponent(value)}`;
}

/** A From preset / On / Off value as the core's choice. */
const toggleChoice = (value: unknown): unknown => (value === "on" ? true : value === "off" ? false : value);

/** bb's settings values (untrusted: they round-trip through storage) as core settings input. */
export function settingsInput(values: Readonly<Record<string, unknown>>): SettingsInput {
  return {
    preset: values["preset"],
    motion: values["motion"],
    intensity: values["intensity"],
    style: values["style"],
    skew: toggleChoice(values["skew"]),
    stickers: values["stickers"],
    jelly: values["jelly"],
    speed: values["speed"],
    art: toggleChoice(values["art"]),
    palette: values["palette"],
    artImage: artImageUrl(values["artImage"]),
    effects: Object.fromEntries(EFFECT_IDS.map((id) => [id, toggleChoice(values[id])])),
  };
}

/** bb's settings values to effective settings: the one path every consumer takes. */
export function effectiveSettings(values: Readonly<Record<string, unknown>>): ReturnType<typeof decodeSettings> {
  return decodeSettings(settingsInput(values));
}

export interface EffectiveRow {
  readonly key: string;
  readonly label: string;
  /** The effective value, as its option label. */
  readonly value: string;
  /** "you set", "from <preset>", or "default". */
  readonly source: string;
}

/** Every presettable setting's effective value and where it came from, for the settings page. */
export function effectiveRows(resolved: Resolved): ReadonlyArray<EffectiveRow> {
  const sourceText = (source: "explicit" | "preset" | "default") =>
    source === "explicit" ? "you set" : source === "preset" ? `from ${resolved.preset.label}` : "default";
  const optionLabel = (key: string, value: string | boolean | null): string => {
    if (typeof value === "boolean") return value ? "On" : "Off";
    if (value === null) return "bb's own theme";
    const descriptor = (SETTINGS as Record<string, PluginSettingDescriptor>)[key];
    const labels = descriptor?.type === "select" ? descriptor.experimental_optionLabels : undefined;
    return labels?.[value] ?? value;
  };
  const scalar = (["motion", "intensity", "style", "skew", "stickers", "jelly", "speed", "palette", "art"] as const).map(
    (key): EffectiveRow => ({
      key,
      label: SETTINGS[key].label,
      value: key === "palette" && resolved.settings.palette !== null ? resolved.settings.palette : optionLabel(key, resolved.settings[key]),
      source: sourceText(resolved.sources[key]),
    }),
  );
  const effects = EFFECT_IDS.map(
    (id): EffectiveRow => ({
      key: id,
      label: EFFECTS[id].label,
      value: optionLabel(id, resolved.settings.effects[id]),
      source: sourceText(resolved.sources.effects[id]),
    }),
  );
  return [...scalar, ...effects];
}
