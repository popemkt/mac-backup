// How each sphere style is tuned: four knobs per style, kept as plugin settings (`<style>.<knob>` reads as
// `jellyVividness`, `auroraHue`, …) and adjustable on the page. 1 is each style's own look for the scalar knobs, which
// is already vivid; hue turns the style's colours around the wheel, in degrees.
import { SPHERE_STYLES, type SphereStyle } from "./sphere-styles.ts";

export const KNOBS = ["vividness", "motion", "glow", "hue"] as const;
export type Knob = (typeof KNOBS)[number];
export type Tune = Record<Knob, number>;

export const KNOB_LABELS: Record<Knob, string> = { vividness: "Vividness", motion: "Motion", glow: "Glow", hue: "Hue" };

/** Each knob's range, default and slider step. */
export const KNOB_RANGE: Record<Knob, { min: number; max: number; default: number; step: number }> = {
  vividness: { min: 0, max: 2, default: 1, step: 0.05 },
  motion: { min: 0, max: 2, default: 1, step: 0.05 },
  glow: { min: 0, max: 2, default: 1, step: 0.05 },
  hue: { min: -180, max: 180, default: 0, step: 5 },
};

export const DEFAULT_TUNE: Tune = { vividness: 1, motion: 1, glow: 1, hue: 0 };

/** The plugin setting that holds one style's knob. */
export function settingKey(style: SphereStyle, knob: Knob): string {
  return `${style}${knob[0]!.toUpperCase()}${knob.slice(1)}`;
}

/** A knob's value brought into its range (and to a number at all). */
export function clampKnob(knob: Knob, value: unknown): number {
  const r = KNOB_RANGE[knob];
  const n = typeof value === "number" && Number.isFinite(value) ? value : r.default;
  return Math.min(r.max, Math.max(r.min, n));
}

/** Every style's tune, read from settings values (missing or wrong values fall back to the defaults). */
export function tunesFrom(values: Record<string, unknown>): Record<SphereStyle, Tune> {
  return Object.fromEntries(
    SPHERE_STYLES.map(style => [style, Object.fromEntries(KNOBS.map(k => [k, clampKnob(k, values[settingKey(style, k)])])) as Tune]),
  ) as Record<SphereStyle, Tune>;
}

/** A knob's value as the page shows it. */
export function formatKnob(knob: Knob, value: number): string {
  return knob === "hue" ? `${value > 0 ? "+" : ""}${Math.round(value)}°` : `${Math.round(value * 100)}%`;
}

export type TunePatch = Partial<Record<Knob, number | null>>;

/**
 * Saves knob changes a moment after the last one, per style, so a drag is one write and switching styles mid-drag
 * loses nothing. Writes for one style run one after another, so an older write never lands after a newer one; when
 * the last write is acknowledged and nothing waits, `onSettled` gets the server's state. `quiet` says when the
 * server's realtime echo may replace what the page shows: not while a change waits or is being written, nor just
 * after (an older write's echo can still be on its way).
 */
export class TuneSaver<R = unknown> {
  private readonly pending = new Map<SphereStyle, TunePatch>();
  private readonly chains = new Map<SphereStyle, Promise<void>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight = 0;
  private settledAt = -Infinity;
  private readonly send: (style: SphereStyle, patch: TunePatch) => Promise<R>;
  private readonly onError: (e: unknown) => void;
  private readonly delayMs: number;
  private readonly now: () => number;
  /** Told the server's answer to the last write, once nothing else waits or is being written. */
  onSettled: ((result: R) => void) | null = null;

  constructor(send: (style: SphereStyle, patch: TunePatch) => Promise<R>, onError: (e: unknown) => void, delayMs = 300, now: () => number = Date.now) {
    this.send = send;
    this.onError = onError;
    this.delayMs = delayMs;
    this.now = now;
  }

  edit(style: SphereStyle, patch: TunePatch): void {
    this.pending.set(style, { ...this.pending.get(style), ...patch });
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  /** Write every waiting change now (also when the page goes away). */
  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    for (const [style, patch] of this.pending) {
      this.inflight++;
      const next = (this.chains.get(style) ?? Promise.resolve()).then(() =>
        this.send(style, patch).then(
          result => this.settle(result, true),
          e => (this.onError(e), this.settle(undefined, false)),
        ),
      );
      this.chains.set(style, next);
    }
    this.pending.clear();
  }

  quiet(): boolean {
    return this.pending.size === 0 && this.inflight === 0 && this.now() - this.settledAt > 800;
  }

  private settle(result: R | undefined, ok: boolean): void {
    this.inflight--;
    this.settledAt = this.now();
    if (ok && this.inflight === 0 && this.pending.size === 0) this.onSettled?.(result as R);
  }
}
