// @popemkt/bb-lively-core: a motion layer for any web app — presses, list
// arrivals, overlay springs, status pulses — driven by root attributes and a
// motion policy. The pure domain (./domain) runs anywhere; the rest needs a DOM.
export * from "./domain/index.ts";
export { type Canary, type CanaryEntry, type CanaryReading, createCanary } from "./dom/canary.ts";
export { createLively, type CreateLivelyOptions, type Lively, type StatusTone, STYLE_ATTRIBUTE } from "./dom/lively.ts";
export { createPulser, type Pulser } from "./dom/pulser.ts";
export { createRowWatcher, type RowWatcher } from "./dom/rows.ts";
export { buildStylesheet, CLASSES, ROOT, ROOT_ATTRIBUTES } from "./dom/stylesheet.ts";
export type { Targets } from "./dom/targets.ts";
