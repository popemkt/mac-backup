// The motion layer as one stylesheet, built once from the host's targets.
// Every effect's rules are scoped to its root attribute
// (`:root[data-lively-press]`), so switching an effect, the level, the
// intensity or the speed only rewrites attributes on <html>; the sheet itself
// never changes.
//
// No effect has a number of its own: every distance, scale, duration, blur,
// glow and easing is a token of the intensity (domain/motion.ts), written
// here once per intensity as custom properties.
//
// Budget, checked by tests/stylesheet.test.ts:
// - keyframes move only transform (`scale`, `translate`, `rotate`),
//   `opacity` and `filter`;
// - lively's transitions add only those, beside the color transitions a host
//   element already had;
// - glows and rings are pseudo-elements whose opacity and scale animate,
//   never an animated box-shadow;
// - one-shot animations on host elements fill `backwards` only, so nothing
//   (no transform, no filter) stays on the element afterwards;
// - the only loops are the breathing glows, which run at the full level only.
import { EFFECT_IDS, type EffectId, effectAttribute } from "../domain/effects.ts";
import {
  exitEasing,
  INTENSITIES,
  type MotionTokens,
  motionTokens,
  springEasing,
  STYLES,
} from "../domain/motion.ts";
import { REDUCED_TOKENS } from "../domain/policy.ts";
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
  intensity: "data-lively-intensity",
  style: "data-lively-style",
  speed: "data-lively-speed",
} as const;

/** Every root attribute lively may write, so cleanup can remove them all. */
export const ROOT_ATTRIBUTES: ReadonlyArray<string> = [
  ROOT.level,
  ROOT.source,
  ROOT.intensity,
  ROOT.style,
  ROOT.speed,
  ...EFFECT_IDS.map(effectAttribute),
];

const is = (selector: string) => `:is(${selector})`;

/** One (style, intensity)'s tokens as custom properties. */
function tokenBlock(tokens: MotionTokens): string {
  return `
  --lively-t-press: ${tokens.pressMs}ms;
  --lively-t-release: ${tokens.releaseMs}ms;
  --lively-t-enter: ${tokens.enterMs}ms;
  --lively-t-overlay: ${tokens.overlayMs}ms;
  --lively-t-exit: ${tokens.exitMs}ms;
  --lively-t-pulse: ${tokens.pulseMs}ms;
  --lively-t-breathe: ${tokens.breatheMs}ms;
  --lively-t-stagger: ${tokens.stagger}ms;
  --lively-spring: ${springEasing(tokens)};
  --lively-rise: ${tokens.rise}px;
  --lively-lift: ${-tokens.lift}px;
  --lively-lift-shadow: ${tokens.liftShadow};
  --lively-blur: ${tokens.blur}px;
  --lively-press-scale: ${tokens.pressScale};
  --lively-overlay-scale: ${tokens.overlayScale};
  --lively-ripple-scale: ${tokens.rippleScale};
  --lively-ring-scale: ${tokens.ringScale};
  --lively-burst: ${tokens.burst};
  --lively-burst-opacity: ${tokens.burst > 0 ? 1 : 0};
  --lively-glow: ${tokens.glow};
  --lively-breathe-depth: ${tokens.breatheMs > 0 ? Math.min(0.6, tokens.glow * 1.5) : 0};`;
}

export function buildStylesheet(targets: Targets): string {
  const suspend = targets.suspendOn.map((attribute) => `:not([${attribute}])`).join("");
  /** The root scope of one effect: on, and nothing is measuring. */
  const on = (effect: EffectId) => `:root[${effectAttribute(effect)}]${suspend}`;
  /** The same, at the full level only (loops never run reduced). */
  const onFull = (effect: EffectId) => `:root[${ROOT.level}="full"][${effectAttribute(effect)}]${suspend}`;
  const reducedRoot = `:root[${ROOT.level}="reduced"]`;
  const systemRoot = `:root[${ROOT.source}="system"]`;

  const intensities = STYLES.flatMap((style) =>
    INTENSITIES.map(
      (intensity) =>
        // The style sits in :where() so a block weighs what an intensity alone did: the
        // reduced and media-query blocks after it must still win.
        `:root[${ROOT.intensity}="${intensity}"]:where([${ROOT.style}="${style}"]) {${tokenBlock(motionTokens(style, intensity))}\n}`,
    ),
  ).join("\n");

  return `/* bb-lively motion layer. Generated; see core/src/dom/stylesheet.ts. */
:root[${ROOT.level}] {
  --lively-speed: 1;
  --lively-press: calc(var(--lively-t-press) * var(--lively-speed));
  --lively-release: calc(var(--lively-t-release) * var(--lively-speed));
  --lively-enter: calc(var(--lively-t-enter) * var(--lively-speed));
  --lively-overlay: calc(var(--lively-t-overlay) * var(--lively-speed));
  --lively-exit: calc(var(--lively-t-exit) * var(--lively-speed));
  --lively-pulse: calc(var(--lively-t-pulse) * var(--lively-speed));
  --lively-breathe: calc(var(--lively-t-breathe) * var(--lively-speed));
  --lively-stagger: calc(var(--lively-t-stagger) * var(--lively-speed));
  --lively-ease-out: ${springEasing({ overshoot: 0 })};
  --lively-ease-in: ${exitEasing()};
  /* One accent, the theme's: the Lively themes and any other palette alike. */
  --lively-accent: var(--primary, #7c6cf0);
  --lively-accent-2: var(--timeline-accent, var(--lively-accent));
  /* Derived from the tokens, not numbers of their own. */
  --lively-pop-from: calc(var(--lively-press-scale) * var(--lively-overlay-scale) * var(--lively-overlay-scale));
  --lively-check-from: calc(var(--lively-press-scale) * var(--lively-overlay-scale));
  /* Status rings sit on rows about three times wider than tall, inside a list that clips
     sideways: growing x a third as much grows the ring by about the same pixels each way. */
  --lively-ring-scale-x: calc(1 + (var(--lively-ring-scale) - 1) / 3);
  --lively-glow-color: color-mix(in oklab, var(--lively-accent) calc(var(--lively-glow) * 100%), transparent);
}
:root[${ROOT.speed}="snappy"] { --lively-speed: 0.8; }
:root[${ROOT.speed}="relaxed"] { --lively-speed: 1.25; }
${intensities}
${reducedRoot} {${tokenBlock(REDUCED_TOKENS)}
}
/* A stale "full" never animates for someone whose OS asks for less motion. */
@media (prefers-reduced-motion: reduce) {
  ${systemRoot} {${tokenBlock(REDUCED_TOKENS)}
  }
  ${systemRoot} ${is(targets.overlayOpen)} {
    --tw-enter-translate-x: 0;
    --tw-enter-translate-y: 0;
  }
  ${systemRoot} ${is(targets.focusBox)}:focus-within::after,
  ${systemRoot} ${is(targets.working)} { animation: none; }
}

@keyframes lively-press-in { to { scale: var(--lively-press-scale); } }
@keyframes lively-press-out { from { scale: var(--lively-press-scale); } to { scale: 1; } }
@keyframes lively-enter {
  from { opacity: 0; translate: 0 var(--lively-rise); filter: blur(var(--lively-blur)); }
  to { opacity: 1; translate: 0 0; filter: blur(0); }
}
@keyframes lively-page { from { opacity: 0; translate: 0 calc(var(--lively-rise) / 2); } }
@keyframes lively-pop { from { opacity: 0; scale: var(--lively-pop-from); } to { opacity: 1; scale: 1; } }
@keyframes lively-check { from { scale: var(--lively-check-from); } to { scale: 1; } }
@keyframes lively-ripple { from { opacity: 0.5; scale: 1; } to { opacity: 0; scale: var(--lively-ripple-scale); } }
@keyframes lively-burst {
  0% { opacity: 0; scale: 0.35; rotate: 0deg; }
  25% { opacity: var(--lively-burst-opacity); }
  100% { opacity: 0; scale: calc(1 + var(--lively-burst)); rotate: calc(var(--lively-burst) * 24deg); }
}
@keyframes lively-ring { 0% { opacity: 0; scale: 1; } 30% { opacity: 1; } 100% { opacity: 0; scale: var(--lively-ring-scale-x) var(--lively-ring-scale); } }
@keyframes lively-breathe { from { opacity: 1; } to { opacity: calc(1 - var(--lively-breathe-depth)); } }
@keyframes lively-working {
  from { opacity: calc(1 - var(--lively-breathe-depth) / 2); filter: drop-shadow(0 0 0 transparent); }
  to { opacity: 1; filter: drop-shadow(0 0 calc(var(--lively-glow) * 20px) var(--lively-glow-color)); }
}

/* press */
${on("press")} ${is(targets.pressable)}:not(${is(targets.pressExclude)}):not(:disabled):active {
  animation: lively-press-in var(--lively-press) var(--lively-ease-out) forwards;
}
${on("press")} .${CLASSES.pressOut} {
  animation: lively-press-out var(--lively-release) var(--lively-spring) backwards;
}

/* hoverLift: a real lift, and a soft shadow that grows with the intensity. */
@media (hover: hover) {
  ${on("hoverLift")} ${is(targets.liftable)} {
    transition-property: translate, filter, opacity, color, background-color, border-color;
    transition-duration: var(--lively-overlay);
    transition-timing-function: var(--lively-spring);
  }
  ${on("hoverLift")} ${is(targets.liftable)}:hover {
    translate: 0 var(--lively-lift);
    filter: drop-shadow(0 calc(var(--lively-lift) * -3) calc(var(--lively-lift) * -6) color-mix(in oklab, #000 calc(var(--lively-lift-shadow) * 100%), transparent));
  }
}

/* listEnter: staggered rise, sharpening from a blur. */
${on("listEnter")} .${CLASSES.enter} {
  animation: lively-enter var(--lively-enter) var(--lively-spring) backwards;
  will-change: transform, opacity, filter;
}
${on("listEnter")} .${CLASSES.enter}[data-lively-stagger="1"] { animation-delay: var(--lively-stagger); }
${on("listEnter")} .${CLASSES.enter}[data-lively-stagger="2"] { animation-delay: calc(var(--lively-stagger) * 2); }
${on("listEnter")} .${CLASSES.enter}[data-lively-stagger="3"] { animation-delay: calc(var(--lively-stagger) * 3); }

/* pageEnter: a thread's window eases in when it mounts. */
${on("pageEnter")} ${is(targets.pageView)} {
  animation: lively-page var(--lively-enter) var(--lively-ease-out) backwards;
}

/* focusRing: a glow drawn once on a pseudo-element; its opacity moves, and breathes at full level. */
${on("focusRing")} ${is(targets.focusBox)}::after {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    0 0 0 1px color-mix(in oklab, var(--lively-accent) 55%, transparent),
    0 0 calc(var(--lively-glow) * 28px) calc(var(--lively-glow) * 6px) var(--lively-glow-color);
  opacity: 0;
  transition: opacity var(--lively-overlay) var(--lively-ease-out);
}
${on("focusRing")} ${is(targets.focusBox)}:focus-within::after { opacity: 1; }
${onFull("focusRing")} ${is(targets.focusBox)}:focus-within::after {
  animation: lively-breathe var(--lively-breathe) var(--lively-ease-out) var(--lively-overlay) infinite alternate;
}

/* sendPulse: a ripple, and at lively and bold a burst of sparks in the accents. */
${on("sendPulse")} .${CLASSES.send} { position: relative; }
${on("sendPulse")} .${CLASSES.send}::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: 0 0 0 2px var(--lively-accent), 0 0 calc(var(--lively-glow) * 24px) var(--lively-glow-color);
  opacity: 0;
  animation: lively-ripple var(--lively-pulse) var(--lively-ease-out);
}
${on("sendPulse")} .${CLASSES.send}::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 4px;
  height: 4px;
  margin: -2px 0 0 -2px;
  border-radius: 50%;
  pointer-events: none;
  opacity: 0;
  box-shadow:
    14px 0 0 0 var(--lively-accent),
    10px 10px 0 -0.5px var(--lively-accent-2),
    0 14px 0 0 var(--lively-accent),
    -10px 10px 0 -0.5px var(--lively-accent-2),
    -14px 0 0 0 var(--lively-accent),
    -10px -10px 0 -0.5px var(--lively-accent-2),
    0 -14px 0 0 var(--lively-accent),
    10px -10px 0 -0.5px var(--lively-accent-2);
  animation: lively-burst var(--lively-pulse) var(--lively-ease-out);
}
${on("sendPulse")} ${is(targets.sendIcon)} {
  animation: lively-pop var(--lively-overlay) var(--lively-spring) backwards;
}

/* statusPulse: two rings in a gradient of the status color, with a soft halo. */
${on("statusPulse")} .${CLASSES.pulse} { --lively-tone: var(--lively-accent); }
${on("statusPulse")} .${CLASSES.pulse}[data-lively-tone="success"] { --lively-tone: var(--success, #3ecf8e); }
${on("statusPulse")} .${CLASSES.pulse}[data-lively-tone="error"] { --lively-tone: var(--destructive, #f2626b); }
${on("statusPulse")} .${CLASSES.pulse}[data-lively-tone="waiting"] { --lively-tone: var(--attention, var(--warning, #e8c547)); }
${on("statusPulse")} .${CLASSES.pulse}::after {
  content: "";
  position: absolute;
  inset: 0;
  padding: 1.5px;
  border-radius: inherit;
  pointer-events: none;
  background: conic-gradient(from 210deg, var(--lively-tone), var(--lively-accent), var(--lively-tone), color-mix(in oklab, var(--lively-tone) 40%, var(--lively-accent)), var(--lively-tone));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  animation: lively-ring var(--lively-pulse) var(--lively-ease-out) 2;
}
${on("statusPulse")} .${CLASSES.pulse}::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: 0 0 calc(var(--lively-glow) * 30px) calc(var(--lively-glow) * 4px) color-mix(in oklab, var(--lively-tone) calc(var(--lively-glow) * 100%), transparent);
  opacity: 0;
  animation: lively-ring var(--lively-pulse) var(--lively-ease-out) 2;
}

/* toastSpring: sonner's transitions are transform, opacity, height, box-shadow, in that order. */
${on("toastSpring")} ${is(targets.toast)} {
  transition-duration: var(--lively-enter), var(--lively-overlay), var(--lively-enter), var(--lively-overlay);
  transition-timing-function: var(--lively-spring), var(--lively-ease-out), var(--lively-ease-out), var(--lively-ease-out);
}

/* overlayEnter: retime the host's own enter/exit keyframes through their per-element variables. */
${on("overlayEnter")} ${is(targets.overlayOpen)} {
  --tw-duration: var(--lively-overlay);
  --tw-ease: var(--lively-spring);
  --tw-enter-scale: var(--lively-overlay-scale);
  --tw-enter-blur: var(--lively-blur);
  transform-origin: var(--radix-popper-transform-origin, center);
}
${on("overlayEnter")}[${ROOT.level}="reduced"] ${is(targets.overlayOpen)} {
  --tw-enter-translate-x: 0;
  --tw-enter-translate-y: 0;
}
${on("overlayEnter")} ${is(targets.overlayClosed)} {
  --tw-duration: var(--lively-exit);
  --tw-ease: var(--lively-ease-in);
}

/* toggles */
${on("toggles")} ${is(targets.switchThumb)} {
  transition-duration: var(--lively-release);
  transition-timing-function: var(--lively-spring);
}
${on("toggles")} .${CLASSES.check} {
  animation: lively-check var(--lively-release) var(--lively-spring) backwards;
}

/* workingGlow: the host's working line breathes an accent glow (full level only). */
${onFull("workingGlow")} ${is(targets.working)} {
  animation: lively-working var(--lively-breathe) var(--lively-ease-out) infinite alternate;
}

/* typingGlow */
${on("typingGlow")} .${CLASSES.typing} { caret-color: var(--lively-accent); }

/* calmHost: set only under reduced motion (the policy). */
${on("calmHost")} ${is(targets.hostAnimation)} { animation: none !important; }
`;
}
