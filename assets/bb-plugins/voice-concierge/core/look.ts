// Per-style tuning, persisted as plugin settings such as jellyVividness and auroraHue.
// Control metadata lives in visuals.ts and drives defaults, validation and the tuning panel.
import { COMMON_KNOBS, VISUAL_STYLES, controlsFor, type VisualStyle } from "./visuals.ts";
type SphereStyle = VisualStyle;
export const KNOBS = Object.keys(COMMON_KNOBS) as (keyof typeof COMMON_KNOBS)[];
export type Knob = keyof typeof COMMON_KNOBS;
export type Tune = Record<Knob, number> & Record<string, number>;
export const KNOB_LABELS = Object.fromEntries(KNOBS.map(k => [k, COMMON_KNOBS[k].label])) as Record<Knob, string>;
export const KNOB_RANGE = COMMON_KNOBS;
export const DEFAULT_TUNE: Tune = Object.fromEntries(KNOBS.map(k => [k, COMMON_KNOBS[k].default])) as Tune;
export const knobsFor = (style: VisualStyle): string[] => Object.keys(controlsFor(style));
export const defaultsFor = (style: VisualStyle): Tune => Object.fromEntries(Object.entries(controlsFor(style)).map(([k, r]) => [k, r.default])) as Tune;
export function settingKey(style: VisualStyle, knob: string): string { return `${style}${knob[0]!.toUpperCase()}${knob.slice(1)}`; }
export function clampKnob(knob: string, value: unknown, style: VisualStyle = "jelly"): number {
  const r = controlsFor(style)[knob];
  if (!r)
    throw new Error(`Unknown control ${knob} for ${style}`);
  const n = typeof value === "number" && Number.isFinite(value) ? value : r.default;
  return Math.min(r.max, Math.max(r.min, n));
}
export function tunesFrom(values: Record<string, unknown>): Record<VisualStyle, Tune> {
  return Object.fromEntries(VISUAL_STYLES.map(style => [style, Object.fromEntries(knobsFor(style).map(k => [k, clampKnob(k, values[settingKey(style, k)], style)]))])) as Record<VisualStyle, Tune>;
}
export function formatKnob(knob: string, value: number, style: VisualStyle = "jelly"): string {
  const unit = controlsFor(style)[knob]?.unit;
  if (unit === "degrees") return `${knob === "hue" && value > 0 ? "+" : ""}${Math.round(value)}°`;
  if (unit === "seconds") return `${Number(value.toFixed(1))}s`;
  return KNOBS.includes(knob as Knob) ? `${Math.round(value * 100)}%` : `${Number(value.toFixed(3))}`;
}
export type TunePatch = Record<string, number | null>;
/**
 * Debounces and merges settings patches by key, then serializes writes for each
 * key. Both style selection and per-style tuning use this queue. `quiet` protects
 * local previews from stale realtime echoes until pending writes have settled.
 */
export class SettingsSaver<R = unknown, K extends string = SphereStyle, P extends object = TunePatch> {
  private readonly pending = new Map<K, P>();
  private readonly chains = new Map<K, Promise<void>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight = 0;
  private settledAt = -Infinity;
  private readonly send: (key: K, patch: P) => Promise<R>;
  private readonly onError: (e: unknown) => void;
  private readonly delayMs: number;
  private readonly now: () => number;
  /** Told the server's answer to the last write, once nothing else waits or is being written. */
  onSettled: ((result: R) => void) | null = null;

  constructor(send: (key: K, patch: P) => Promise<R>, onError: (e: unknown) => void, delayMs = 300, now: () => number = Date.now) {
    this.send = send;
    this.onError = onError;
    this.delayMs = delayMs;
    this.now = now;
  }

  edit(style: K, patch: P): void {
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
      const next = (this.chains.get(style) ?? Promise.resolve())
        .then(() => this.send(style, patch))
        .then(
          result => this.settle(result, true),
          e => (this.onError(e), this.settle(undefined, false)),
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
