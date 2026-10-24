// The motion layer as one stylesheet, built once from the host's targets.
// Every effect's rules are scoped to its root attribute
// (`:root[data-lively-press]`), so switching an effect, the level or the speed
// only rewrites attributes on <html>; the sheet itself never changes.
//
// Budget, checked by tests/stylesheet.test.ts:
// - keyframes move only transform (`scale`, `translate`) and `opacity`;
// - lively's transitions add only `translate` and `opacity`, beside the
//   color transitions a host element already had;
// - glows and rings are a pseudo-element whose opacity animates, never an
//   animated box-shadow;
// - `will-change` only on a class that lives for one animation.
import { EFFECT_IDS, type EffectId, effectAttribute } from "../domain/effects.ts";
import type { Targets } from "./targets.ts";

/** The classes the DOM layer sets for one animation each. */
export const CLASSES = {
  enter: "lively-enter",
  pressOut: "lively-press-out",
  send: "lively-send",
  pulse: "lively-pulse",
  check: "lively-check",
  typing: "lively-typing",
} as const;

/** Root attributes besides the per-effect ones. */
export const ROOT = {
  level: "data-lively",
  source: "data-lively-source",
  speed: "data-lively-speed",
} as const;

/** Every root attribute lively may write, so cleanup can remove them all. */
export const ROOT_ATTRIBUTES: ReadonlyArray<string> = [
  ROOT.level,
  ROOT.source,
  ROOT.speed,
  ...EFFECT_IDS.map(effectAttribute),
];

const is = (selector: string) => `:is(${selector})`;

/** The values "reduced" swaps in: no travel, no overshoot, 120 ms fades. */
const REDUCED_TOKENS = `
  --lively-rise: 0px;
  --lively-lift: 0px;
  --lively-press-scale: 1;
  --lively-pop-from: 1;
  --lively-check-from: 1;
  --lively-ripple-from: 1;
  --lively-ripple-to: 1;
  --lively-ring-to: 1;
  --lively-overlay-scale: 1;
  --lively-spring: var(--lively-ease-out);
  --lively-d2: 120ms;
  --lively-d3: 120ms;
  --lively-d4: 120ms;`;

export function buildStylesheet(targets: Targets): string {
  const suspend = targets.suspendOn.map((attribute) => `:not([${attribute}])`).join("");
  /** The root scope of one effect: on, and nothing is measuring. */
  const on = (effect: EffectId) => `:root[${effectAttribute(effect)}]${suspend}`;
  const reducedRoot = `:root[${ROOT.level}="reduced"]`;
  const systemRoot = `:root[${ROOT.source}="system"]`;

  return `/* bb-lively motion layer. Generated; see core/src/dom/stylesheet.ts. */
:root[${ROOT.level}] {
  --lively-speed: 1;
  --lively-d1: calc(90ms * var(--lively-speed));
  --lively-d2: calc(160ms * var(--lively-speed));
  --lively-d3: calc(220ms * var(--lively-speed));
  --lively-d4: calc(300ms * var(--lively-speed));
  --lively-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --lively-ease-in: cubic-bezier(0.4, 0, 1, 1);
  --lively-spring: linear(0, 0.32 8%, 0.7 18%, 0.93 30%, 1.025 42%, 1.02 55%, 1.005 70%, 1);
  --lively-accent: var(--primary, #7c6cf0);
  --lively-rise: 6px;
  --lively-lift: -1px;
  --lively-press-scale: 0.97;
  --lively-pop-from: 0.6;
  --lively-check-from: 0.86;
  --lively-ripple-from: 0.9;
  --lively-ripple-to: 1.6;
  --lively-ring-to: 1.035;
  --lively-overlay-scale: 0.96;
}
:root[${ROOT.speed}="snappy"] { --lively-speed: 0.8; }
:root[${ROOT.speed}="relaxed"] { --lively-speed: 1.25; }
${reducedRoot} {${REDUCED_TOKENS}
}
/* A stale "full" never animates for someone whose OS asks for less motion. */
@media (prefers-reduced-motion: reduce) {
  ${systemRoot} {${REDUCED_TOKENS}
  }
  ${systemRoot} ${is(targets.overlayOpen)} {
    --tw-enter-translate-x: 0;
    --tw-enter-translate-y: 0;
  }
}

@keyframes lively-press-in { to { scale: var(--lively-press-scale); } }
@keyframes lively-press-out { from { scale: var(--lively-press-scale); } to { scale: 1; } }
@keyframes lively-enter { from { opacity: 0; translate: 0 var(--lively-rise); } to { opacity: 1; translate: 0 0; } }
@keyframes lively-pop { from { opacity: 0; scale: var(--lively-pop-from); } to { opacity: 1; scale: 1; } }
@keyframes lively-check { from { scale: var(--lively-check-from); } to { scale: 1; } }
@keyframes lively-ripple { from { opacity: 0.45; scale: var(--lively-ripple-from); } to { opacity: 0; scale: var(--lively-ripple-to); } }
@keyframes lively-ring { 0% { opacity: 0; scale: 1; } 30% { opacity: 0.9; } 100% { opacity: 0; scale: var(--lively-ring-to); } }

/* press */
${on("press")} ${is(targets.pressable)}:not(${is(targets.pressExclude)}):not(:disabled):active {
  animation: lively-press-in var(--lively-d1) var(--lively-ease-out) forwards;
}
${on("press")} .${CLASSES.pressOut} {
  animation: lively-press-out var(--lively-d2) var(--lively-spring);
}

/* hoverLift */
@media (hover: hover) {
  ${on("hoverLift")} ${is(targets.liftable)} {
    transition-property: translate, opacity, color, background-color, border-color;
    transition-duration: var(--lively-d2);
    transition-timing-function: var(--lively-ease-out);
  }
  ${on("hoverLift")} ${is(targets.liftable)}:hover {
    translate: 0 var(--lively-lift);
  }
}

/* listEnter */
${on("listEnter")} .${CLASSES.enter} {
  animation: lively-enter var(--lively-d3) var(--lively-ease-out) both;
  will-change: transform, opacity;
}
${on("listEnter")} .${CLASSES.enter}[data-lively-stagger="1"] { animation-delay: 30ms; }
${on("listEnter")} .${CLASSES.enter}[data-lively-stagger="2"] { animation-delay: 60ms; }
${on("listEnter")} .${CLASSES.enter}[data-lively-stagger="3"] { animation-delay: 90ms; }

/* focusRing: a glow drawn once on a pseudo-element; only its opacity moves. */
${on("focusRing")} ${is(targets.focusBox)}::after {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    0 0 0 1px color-mix(in oklab, var(--lively-accent) 55%, transparent),
    0 0 0 4px color-mix(in oklab, var(--lively-accent) 14%, transparent);
  opacity: 0;
  transition: opacity var(--lively-d2) var(--lively-ease-out);
}
${on("focusRing")} ${is(targets.focusBox)}:focus-within::after { opacity: 1; }

/* sendPulse */
${on("sendPulse")} .${CLASSES.send} { position: relative; }
${on("sendPulse")} .${CLASSES.send}::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: 0 0 0 2px var(--lively-accent);
  opacity: 0;
  animation: lively-ripple var(--lively-d3) var(--lively-ease-out);
}
${on("sendPulse")} ${is(targets.sendIcon)} {
  animation: lively-pop var(--lively-d2) var(--lively-spring) both;
}

/* statusPulse: two rings in the status color, then nothing. */
${on("statusPulse")} .${CLASSES.pulse} { --lively-tone: var(--lively-accent); }
${on("statusPulse")} .${CLASSES.pulse}[data-lively-tone="success"] { --lively-tone: var(--success, #3ecf8e); }
${on("statusPulse")} .${CLASSES.pulse}[data-lively-tone="error"] { --lively-tone: var(--destructive, #f2626b); }
${on("statusPulse")} .${CLASSES.pulse}[data-lively-tone="waiting"] { --lively-tone: var(--attention, var(--warning, #e8c547)); }
${on("statusPulse")} .${CLASSES.pulse}::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    0 0 0 1.5px var(--lively-tone),
    0 0 14px -4px var(--lively-tone);
  opacity: 0;
  animation: lively-ring var(--lively-d4) var(--lively-ease-out) 2;
}

/* toastSpring: sonner's transitions are transform, opacity, height, box-shadow, in that order. */
${on("toastSpring")} ${is(targets.toast)} {
  transition-timing-function: var(--lively-spring), var(--lively-ease-out), var(--lively-ease-out), ease;
}

/* overlayEnter: retime the host's own enter/exit keyframes through their per-element variables. */
${on("overlayEnter")} ${is(targets.overlayOpen)} {
  --tw-duration: var(--lively-d2);
  --tw-ease: var(--lively-spring);
  --tw-enter-scale: var(--lively-overlay-scale);
  transform-origin: var(--radix-popper-transform-origin, center);
}
${on("overlayEnter")}[${ROOT.level}="reduced"] ${is(targets.overlayOpen)} {
  --tw-enter-translate-x: 0;
  --tw-enter-translate-y: 0;
}
${on("overlayEnter")} ${is(targets.overlayClosed)} {
  --tw-duration: var(--lively-d1);
  --tw-ease: var(--lively-ease-in);
}

/* toggles */
${on("toggles")} ${is(targets.switchThumb)} {
  transition-duration: var(--lively-d2);
  transition-timing-function: var(--lively-spring);
}
${on("toggles")} .${CLASSES.check} {
  animation: lively-check var(--lively-d2) var(--lively-spring);
}

/* typingGlow */
${on("typingGlow")} .${CLASSES.typing} { caret-color: var(--lively-accent); }

/* calmHost: set only under reduced motion (the policy). */
${on("calmHost")} ${is(targets.hostAnimation)} { animation: none !important; }
`;
}
