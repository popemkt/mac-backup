// The pure domain: effects, settings, the motion system and policy. No DOM.
export { EFFECT_IDS, EffectId, type EffectInfo, EFFECTS, effectAttribute } from "./effects.ts";
export {
  DEFAULT_STYLE,
  exitEasing,
  INTENSITIES,
  Intensity,
  landsAt,
  MAX_ONCE_MS,
  MAX_PRESS_MS,
  MOTION_TOKENS,
  motionTokens,
  type MotionTokens,
  type Spring,
  springEasing,
  springPoints,
  Style,
  STYLES,
} from "./motion.ts";
export {
  DEFAULT_SETTINGS,
  decodeSettings,
  MOTION_MODES,
  MotionMode,
  type Settings,
  type SettingsInput,
  type SettingsProblem,
  Speed,
  SPEED_FACTOR,
  SPEEDS,
} from "./settings.ts";
export {
  MAX_CONCURRENT_ENTERS,
  type MotionLevel,
  type MotionPolicy,
  REDUCED_TOKENS,
  resolveMotion,
  tokensFor,
} from "./policy.ts";
