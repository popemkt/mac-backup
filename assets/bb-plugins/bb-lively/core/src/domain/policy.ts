// The motion policy: from the settings and whether the system asks for less
// motion, which level runs and which effects are on. The one place that
// decides; the DOM layer only writes the answer onto the root element.
import { EFFECT_IDS, EFFECTS, type EffectId } from "./effects.ts";
import type { Settings, Speed } from "./settings.ts";

/** `full` animates; `reduced` keeps short opacity fades only; `off` writes nothing. */
export type MotionLevel = "full" | "reduced" | "off";

export interface MotionPolicy {
  readonly level: MotionLevel;
  /**
   * `system` when the level follows the OS preference (so a stylesheet can
   * also honour the media query directly), `user` when the setting forced it.
   */
  readonly source: "system" | "user";
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
  return { level, source, speed: settings.speed, effects };
}

/** Budget: the most list rows that animate at once; the rest appear at rest. */
export const MAX_CONCURRENT_ENTERS = 4;
/** Budget: no animation lively starts runs longer than this (ms, at normal speed). */
export const MAX_DURATION_MS = 300;
