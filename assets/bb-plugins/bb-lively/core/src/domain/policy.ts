// The motion policy: from the settings and whether the system asks for less
// motion, which level runs, at which intensity, and which effects are on. The
// one place that decides; the DOM layer only writes the answer onto the root
// element.
import { EFFECT_IDS, EFFECTS, type EffectId } from "./effects.ts";
import { DEFAULT_STYLE, type Intensity, type MotionTokens, motionTokens, type Style } from "./motion.ts";
import { type Settings, type Speed, SPEED_FACTOR } from "./settings.ts";

/** `full` animates; `reduced` keeps short opacity fades only; `off` writes nothing. */
export type MotionLevel = "full" | "reduced" | "off";

export interface MotionPolicy {
  readonly level: MotionLevel;
  /**
   * `system` when the level follows the OS preference (so a stylesheet can
   * also honour the media query directly), `user` when the setting forced it.
   */
  readonly source: "system" | "user";
  /** The volume of every effect. Under `reduced` it still names the setting, but every effect collapses to a fade. */
  readonly intensity: Intensity;
  /** The character of the motion; with one style today, always `clean`. */
  readonly style: Style;
  readonly speed: Speed;
  /** The effects that run, in table order. Empty when the level is `off`. */
  readonly effects: ReadonlyArray<EffectId>;
}

export function resolveMotion(settings: Settings, systemReduced: boolean): MotionPolicy {
  const source = settings.motion === "system" ? "system" : "user";
  const level: MotionLevel =
    settings.motion === "system" ? (systemReduced ? "reduced" : "full") : settings.motion;
  const effects =
    level === "off"
      ? []
      : EFFECT_IDS.filter(
          (id) =>
            settings.effects[id] &&
            (level === "full" ? id !== "calmHost" : EFFECTS[id].reducedSafe),
        );
  return { level, source, intensity: settings.intensity, style: DEFAULT_STYLE, speed: settings.speed, effects };
}

/** The reduced level's tokens: no travel, no overshoot, no blur, no particles, no breathing, 120 ms. */
export const REDUCED_TOKENS: MotionTokens = {
  pressMs: 120,
  releaseMs: 120,
  enterMs: 120,
  overlayMs: 120,
  exitMs: 120,
  pulseMs: 120,
  breatheMs: 0,
  overshoot: 0,
  bounces: 1,
  rise: 0,
  lift: 0,
  liftShadow: 0,
  blur: 0,
  stagger: 0,
  pressScale: 1,
  overlayScale: 1,
  rippleScale: 1,
  ringScale: 1,
  burst: 0,
  glow: motionTokens(DEFAULT_STYLE, "subtle").glow,
};

/** The tokens in force for a policy, with speed applied to durations. */
export function tokensFor(policy: MotionPolicy): MotionTokens {
  if (policy.level === "reduced") return REDUCED_TOKENS;
  const base = motionTokens(policy.style, policy.intensity);
  const factor = SPEED_FACTOR[policy.speed];
  return {
    ...base,
    pressMs: base.pressMs * factor,
    releaseMs: base.releaseMs * factor,
    enterMs: base.enterMs * factor,
    overlayMs: base.overlayMs * factor,
    exitMs: base.exitMs * factor,
    pulseMs: base.pulseMs * factor,
    breatheMs: base.breatheMs * factor,
    stagger: base.stagger * factor,
  };
}

/** Budget: the most list rows that animate at once; the rest appear at rest. */
export const MAX_CONCURRENT_ENTERS = 4;
