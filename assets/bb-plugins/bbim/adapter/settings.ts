// bbim's plugin settings: the one table that both declares them to bb
// (server.ts) and reads them back into the core's settings (app.tsx).
// Validation is the core's schemas plus bb's own rule about digits.
import type { PluginSettingDescriptor } from "@get-bb/plugin-sdk";
import { Result, Schema } from "effect";
import {
  ACTION_INFO,
  ACTIONS,
  type Action,
  DEFAULT_SETTINGS,
  KeySequence,
  parseSequence,
  SETTING_SCHEMAS,
  type SettingsInput,
} from "@popemkt/bbim-core/domain";

/**
 * A key setting as bb validates it: the core's notation, and no binding that
 * starts with a digit, which bb uses to answer an agent's pending question.
 */
export const BbKeySequence = KeySequence.check(
  Schema.makeFilter((value: string) => {
    const parsed = parseSequence(value);
    const first = Result.isSuccess(parsed) ? parsed.success[0] : undefined;
    return first !== undefined && /^[0-9]$/u.test(first.key) && !first.alt && !first.ctrl && !first.meta
      ? "digits are bb's answers to agent questions"
      : undefined;
  }),
);

/** The bb setting id of each action's key, e.g. `key.scrollDown`. */
export const keySettingId = (action: Action): `key.${Action}` => `key.${action}`;

const keyDescriptors: Record<string, PluginSettingDescriptor> = Object.fromEntries(
  ACTIONS.map((action) => [
    keySettingId(action),
    {
      type: "string",
      label: `Key: ${ACTION_INFO[action].label}`,
      description:
        action === "hints"
          ? "Vim notation: `f`, `gg`, `<A-f>` (alt+f), `<C-d>`, `<Space>`. Empty unbinds. The alt+f chord itself is a bb command: rebind it in Settings → Keyboard."
          : undefined,
      default: DEFAULT_SETTINGS.keys[action],
      experimental_schema: Schema.toStandardSchemaV1(BbKeySequence),
    } satisfies PluginSettingDescriptor,
  ]),
);

export const SETTINGS = {
  bareKeys: {
    type: "boolean",
    label: "Single-key shortcuts",
    description:
      "f, j, k, d, u, gg, G, gi and ? work while nothing you can type into, no terminal and no browser tab has focus, and no dialog is open. Off leaves only the bb commands (alt+f, alt+shift+f).",
    default: DEFAULT_SETTINGS.bareKeys,
    experimental_schema: Schema.toStandardSchemaV1(SETTING_SCHEMAS.bareKeys),
  },
  hintAlphabet: {
    type: "string",
    label: "Hint letters",
    description: "The letters hint labels are spelled in, strongest keys first: the first ones become single-key labels.",
    default: DEFAULT_SETTINGS.hintAlphabet,
    experimental_schema: Schema.toStandardSchemaV1(SETTING_SCHEMAS.hintAlphabet),
  },
  ...keyDescriptors,
  scrollStep: {
    type: "number",
    label: "Scroll step (pixels)",
    default: DEFAULT_SETTINGS.scrollStep,
    experimental_schema: Schema.toStandardSchemaV1(SETTING_SCHEMAS.scrollStep),
  },
  sequenceTimeoutMs: {
    type: "number",
    label: "Key sequence timeout (ms)",
    description: "How long gg or gi waits for its second key.",
    default: DEFAULT_SETTINGS.sequenceTimeoutMs,
    experimental_schema: Schema.toStandardSchemaV1(SETTING_SCHEMAS.sequenceTimeoutMs),
  },
} satisfies Record<string, PluginSettingDescriptor>;

/** bb's settings values (untrusted: they round-trip through storage) as core settings input. */
export function settingsInput(values: Readonly<Record<string, unknown>>): SettingsInput {
  const keys: Partial<Record<Action, unknown>> = {};
  for (const action of ACTIONS) {
    const raw = values[keySettingId(action)];
    if (raw === undefined) continue;
    // bb's rule on top of the core's: a digit-led binding falls back like any invalid one.
    keys[action] = Result.isSuccess(Schema.decodeUnknownResult(BbKeySequence)(raw)) ? raw : null;
  }
  return {
    bareKeys: values["bareKeys"],
    hintAlphabet: values["hintAlphabet"],
    scrollStep: values["scrollStep"],
    sequenceTimeoutMs: values["sequenceTimeoutMs"],
    keys,
  };
}
