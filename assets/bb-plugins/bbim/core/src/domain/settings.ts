// The settings schema: what a host may configure, decoded from untrusted input
// field by field, so one bad value falls back to its default instead of
// discarding the rest.
import { Result, Schema } from "effect";
import { ACTION_INFO, ACTIONS, type Action } from "./actions.ts";
import { type KeyStroke, parseSequence } from "./keys.ts";
import { DEFAULT_ALPHABET, HintAlphabet } from "./labels.ts";

/**
 * A key sequence in vim notation (keys.ts). Empty means unbound. Escape is
 * every mode's way out, so no binding may start with it.
 */
export const KeySequence = Schema.String.check(
  Schema.makeFilter((value: string) => {
    const parsed = parseSequence(value);
    if (Result.isFailure(parsed)) return parsed.failure.message;
    if (parsed.success[0]?.key === "Escape") return "Escape is reserved for leaving a mode";
    return undefined;
  }),
);

export interface Settings {
  /** Single keys with no ctrl/alt/meta (`j`, `gg`) are active. Chords always are. */
  readonly bareKeys: boolean;
  readonly hintAlphabet: string;
  /** Pixels per `scrollDown` / `scrollUp`. */
  readonly scrollStep: number;
  /** How long a multi-key sequence (`gg`) waits for its next key. */
  readonly sequenceTimeoutMs: number;
  readonly keys: Readonly<Record<Action, string>>;
}

export const DEFAULT_SETTINGS: Settings = {
  bareKeys: true,
  hintAlphabet: DEFAULT_ALPHABET,
  scrollStep: 70,
  sequenceTimeoutMs: 1000,
  keys: Object.fromEntries(ACTIONS.map((action) => [action, ACTION_INFO[action].key])) as Record<Action, string>,
};

/** The schema of each scalar setting; a host validating its own settings UI reuses these. */
export const SETTING_SCHEMAS = {
  bareKeys: Schema.Boolean,
  hintAlphabet: HintAlphabet,
  scrollStep: Schema.Int.check(Schema.isBetween({ minimum: 10, maximum: 2000 })),
  sequenceTimeoutMs: Schema.Int.check(Schema.isBetween({ minimum: 200, maximum: 5000 })),
} as const;


export interface SettingsInput {
  readonly bareKeys?: unknown;
  readonly hintAlphabet?: unknown;
  readonly scrollStep?: unknown;
  readonly sequenceTimeoutMs?: unknown;
  readonly keys?: Readonly<Partial<Record<string, unknown>>>;
}

export interface SettingsProblem {
  /** `hintAlphabet`, or `keys.<action>`. */
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

/**
 * Decode settings from untrusted input. Missing fields take `base`'s value
 * (the defaults unless given); an invalid field does too, and is reported.
 */
export function decodeSettings(
  input: SettingsInput,
  base: Settings = DEFAULT_SETTINGS,
): { readonly settings: Settings; readonly problems: ReadonlyArray<SettingsProblem> } {
  const problems: Array<SettingsProblem> = [];
  const keys = Object.fromEntries(
    ACTIONS.map((action) => [
      action,
      decodeField(KeySequence, `keys.${action}`, input.keys?.[action], base.keys[action], problems),
    ]),
  ) as Record<Action, string>;
  const settings: Settings = {
    bareKeys: decodeField(SETTING_SCHEMAS.bareKeys, "bareKeys", input.bareKeys, base.bareKeys, problems),
    hintAlphabet: decodeField(SETTING_SCHEMAS.hintAlphabet, "hintAlphabet", input.hintAlphabet, base.hintAlphabet, problems),
    scrollStep: decodeField(SETTING_SCHEMAS.scrollStep, "scrollStep", input.scrollStep, base.scrollStep, problems),
    sequenceTimeoutMs: decodeField(
      SETTING_SCHEMAS.sequenceTimeoutMs,
      "sequenceTimeoutMs",
      input.sequenceTimeoutMs,
      base.sequenceTimeoutMs,
      problems,
    ),
    keys,
  };
  return { settings, problems };
}

/** The settings' keymap as bindings, in action order (earlier wins a conflict). */
export function keyBindings(settings: Settings): ReadonlyArray<{ sequence: ReadonlyArray<KeyStroke>; action: Action }> {
  return ACTIONS.flatMap((action) => {
    const parsed = parseSequence(settings.keys[action]);
    return Result.isSuccess(parsed) && parsed.success.length > 0 ? [{ sequence: parsed.success, action }] : [];
  });
}
