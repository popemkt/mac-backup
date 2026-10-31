// The motion policy: from the settings and whether the system asks for less
// motion, which level runs, at which intensity and style, and which effects are on. The
// one place that decides; the DOM layer only writes the answer onto the root
// element.
import { EFFECT_IDS, EFFECTS, type EffectId, effectInPreset } from "./effects.ts";
import { type Intensity, type MotionTokens, motionTokens, type Style } from "./motion.ts";
import { defaultSendForm, type SendForm } from "./send.ts";
import { type JellyMode, type Settings, type Speed, SPEED_FACTOR } from "./settings.ts";

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
  /** The shape of the motion. Wobbly's own rules run at the full level only, so under `reduced` both styles are the same fades. */
  readonly style: Style;
  /** Arriving rows skew in: the wobbly style, its skew switch on, at the full level. */
  readonly skew: boolean;
  /** Hard offset shadows show. They are paint, not motion, so they stay under `reduced`. */
  readonly stickers: boolean;
  readonly jelly: JellyMode;
  readonly speed: Speed;
  /** The active preset: its art and fonts paint under `data-lively-preset`. */
  readonly preset: string;
  /** The preset's art layer and the person's own image show. Paint, not motion: it stays under `reduced`. */
  readonly art: boolean;
  /** The person's art image URL ("" for none); shown only with `art`. */
  readonly artImage: string;
  /** The effects that run, in table order. Empty when the level is `off`. */
  readonly effects: ReadonlyArray<EffectId>;
  /** The active preset's own tokens (presets.ts `tokens`), at the full level only; empty otherwise. */
  readonly overrides: Partial<MotionTokens>;
  /** The form a send takes (domain/send.ts): the preset's, else the style's. Under reduced motion every form is the same fade. */
  readonly send: SendForm;
}

/** `overrides` is the active preset's `tokens`: they apply at the full level only; `send` is its send form, if it names one. */
export function resolveMotion(settings: Settings, systemReduced: boolean, overrides: Partial<MotionTokens> = {}, send?: SendForm): MotionPolicy {
  const source = settings.motion === "system" ? "system" : "user";
  const level: MotionLevel =
    settings.motion === "system" ? (systemReduced ? "reduced" : "full") : settings.motion;
  const effects =
    level === "off"
      ? []
      : EFFECT_IDS.filter(
          (id) =>
            settings.effects[id] &&
            effectInPreset(EFFECTS[id], settings.preset) &&
            (level === "full" ? id !== "calmHost" : EFFECTS[id].reducedSafe),
        );
  const stickers = level !== "off" && (settings.stickers === "always" || (settings.stickers === "wobbly" && settings.style === "wobbly"));
  return {
    level,
    source,
    intensity: settings.intensity,
    style: settings.style,
    skew: level === "full" && settings.style === "wobbly" && settings.skew,
    stickers,
    jelly: settings.jelly,
    speed: settings.speed,
    preset: settings.preset,
    // Art is paint, not motion: its own switch, which motion "off" leaves alone.
    art: settings.art,
    artImage: settings.art ? settings.artImage : "",
    effects,
    overrides: level === "full" ? overrides : {},
    send: send ?? defaultSendForm(settings.style),
  };
}

/**
 * The reduced level's tokens, for either style: no travel, no overshoot, no
 * blur, no particles, no breathing, no squash, skew, tilt, swell, flash or
 * chroma, 120 ms. The sticker distance stays (a shadow is paint, not motion).
 */
export const REDUCED_TOKENS: MotionTokens = {
  pressMs: 120,
  releaseMs: 120,
  enterMs: 120,
  overlayMs: 120,
  exitMs: 120,
  pulseMs: 120,
  breatheMs: 0,
  overshoot: 0,
  peakAt: 0.4,
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
  glow: motionTokens("clean", "subtle").glow,
  squash: 0,
  skew: 0,
  tilt: 0,
  sticker: motionTokens("clean", "lively").sticker,
  swell: 0,
  flash: 0,
  chroma: 0,
  travel: 0,
};

/** The tokens in force for a policy, with speed applied to durations. */
export function tokensFor(policy: MotionPolicy): MotionTokens {
  if (policy.level === "reduced") return REDUCED_TOKENS;
  const base = { ...motionTokens(policy.style, policy.intensity), ...policy.overrides };
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
