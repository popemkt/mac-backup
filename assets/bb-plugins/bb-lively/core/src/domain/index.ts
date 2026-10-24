// The pure domain: effects, settings, the motion policy. No DOM.
export { EFFECT_IDS, EffectId, type EffectInfo, EFFECTS, effectAttribute } from "./effects.ts";
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
export { MAX_CONCURRENT_ENTERS, MAX_DURATION_MS, type MotionLevel, type MotionPolicy, resolveMotion } from "./policy.ts";
