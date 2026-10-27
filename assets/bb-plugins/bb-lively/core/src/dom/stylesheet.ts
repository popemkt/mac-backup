// The motion layer as one stylesheet, built once from the host's targets.
// Every effect's rules are scoped to its root attribute
// (`:root[data-lively-press]`), so switching an effect, the level, the
// intensity, the style or the speed only rewrites attributes on <html>; the
// sheet itself never changes.
//
// No effect has a number of its own: every distance, scale, duration, blur,
// glow, squash, skew and easing is a token of the (style, intensity)
// (domain/motion.ts), written here once per pair as custom properties.
//
// Two styles share the effects. The clean rules are the base; each effect's
// wobbly variant is a second rule scoped to `[data-lively="full"]
// [data-lively-style="wobbly"]`, which outweighs the clean one and never runs
// under reduced motion, so both styles reduce to the same fades.
//
// Budget, checked by tests/stylesheet.test.ts:
// - keyframes move only `scale`, `translate`, `rotate`, `opacity` and
//   `filter`; the one exception is the skew-in, a `transform` that is only
//   ever run with `animation-composition: add`, on top of the host's own
//   transform, and never on toasts;
// - lively's transitions add only those, beside the color transitions a host
//   element already had;
// - glows, rings, bursts and the page wipe are pseudo-elements; nothing
//   animates a box-shadow;
// - one-shot animations on host elements fill `backwards` only, so nothing
//   (no transform, no filter) stays on the element afterwards;
// - the only loops are the breathing glows, which run at the full level only.
import { EFFECT_IDS, type EffectId, effectAttribute } from "../domain/effects.ts";
import {
  exitEasing,
  INTENSITIES,
  type Intensity,
  jellyCoefficients,
  type MotionTokens,
  motionTokens,
  snapEasing,
  springEasing,
  STYLES,
} from "../domain/motion.ts";
import { REDUCED_TOKENS } from "../domain/policy.ts";
import { SEND_FORM_INFO, SEND_FORMS, type SendForm } from "../domain/send.ts";
import { type Preset, PRESETS } from "../domain/presets.ts";
import { ART_ROOT, buildArtStylesheet } from "./art.ts";
import { cssString } from "./css.ts";
import type { Targets } from "./targets.ts";

/** The classes the DOM layer sets for one animation each. */
export const CLASSES = {
  enter: "lively-enter",
  pressOut: "lively-press-out",
  send: "lively-send",
  pulse: "lively-pulse",
  check: "lively-check",
  typing: "lively-typing",
  /** A thread switch replays the page entrance on the window that stayed mounted. */
  page: "lively-page-in",
  /** A send's ghost on its way out of the composer, the send's echo landing, and the turn's first reply (send.ts). */
  depart: "lively-depart",
  arrive: "lively-arrive",
  reply: "lively-reply",
} as const;

/**
 * Set (and kept) on a thread window once lively has replayed its entrance: the
 * mount rule stops matching, so taking the replay class off later never restarts it.
 */
export const PAGE_REPLAYED = "data-lively-paged";

/**
 * A send's ghost (lively's own copy of the words, send.ts) and its parts; and the mark on a ghost
 * or a landing message the canvas draws in its stead (the dust).
 */
export const GHOST_ATTRIBUTE = "data-lively-ghost";
export const DRAWN_ATTRIBUTE = "data-lively-drawn";

/** Attributes the DOM layer sets on a pulsing element beside its class. */
export const PULSE_ATTRIBUTES = {
  stagger: "data-lively-stagger",
  /** The last row of an arriving batch (the wobbly chromatic split runs on it alone). */
  last: "data-lively-last",
  tone: "data-lively-tone",
} as const;

/** Root attributes besides the per-effect ones. */
export const ROOT = {
  level: "data-lively",
  source: "data-lively-source",
  intensity: "data-lively-intensity",
  style: "data-lively-style",
  /** `on` when arriving rows skew in (wobbly, its skew switch on, full level). */
  skew: "data-lively-skew",
  /** `on` while hard offset "sticker" shadows show. */
  stickers: "data-lively-stickers",
  /** `matched` when the wobbly release decays like the intensity's own spring. */
  jelly: "data-lively-jelly",
  speed: "data-lively-speed",
  /** `on` while lively's HTML-in-Canvas layer draws the canvas effects; their CSS fallbacks stand down. */
  canvas: "data-lively-canvas",
  /** The form a send takes (domain/send.ts). */
  send: "data-lively-send",
  ...ART_ROOT,
} as const;

/** Every root attribute lively may write, so cleanup can remove them all. */
export const ROOT_ATTRIBUTES: ReadonlyArray<string> = [...Object.values(ROOT), ...EFFECT_IDS.map(effectAttribute)];

const is = (selector: string) => `:is(${selector})`;

/** The wobbly release for one intensity: the jelly keyframes are named by it. */
const jellyName = (intensity: Intensity) => `lively-jelly-${intensity}`;

/** One (style, intensity)'s tokens as custom properties. */
function tokenBlock(tokens: MotionTokens, jelly: string): string {
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
  --lively-breathe-depth: ${tokens.breatheMs > 0 ? Math.min(0.6, tokens.glow * 1.5) : 0};
  --lively-squash: ${tokens.squash};
  --lively-skew: ${tokens.skew}deg;
  --lively-tilt: ${tokens.tilt}deg;
  --lively-sticker: ${tokens.sticker}px;
  --lively-swell: ${tokens.swell};
  --lively-flash: ${tokens.flash};
  --lively-chroma: ${tokens.chroma}px;
  --lively-jelly-own: ${jelly};`;
}

/**
 * The jelly for one intensity: a squash (wide and short), then the swings of
 * that intensity's wobbly spring, each −overshoot times the last.
 * `--lively-squash-k` lets a caller scale the whole jelly down.
 */
function jellyKeyframes(intensity: Intensity): string {
  const coefficients = jellyCoefficients(motionTokens("wobbly", intensity).overshoot);
  const step = 100 / (coefficients.length + 0.5);
  const stops = coefficients.map((coefficient, index) => {
    const amount = `var(--lively-squash) * var(--lively-squash-k, 1) * ${coefficient}`;
    return `  ${Math.round(index * step)}% { scale: calc(1 + ${amount}) calc(1 - ${amount}); }`;
  });
  return `@keyframes ${jellyName(intensity)} {\n${stops.join("\n")}\n  100% { scale: 1 1; }\n}`;
}

/** Suffix of the keyframe copies a thread switch replays (see pageEnter). */
const AGAIN = "-again";
/** The thread window's keyframes: clean entrance, wobbly entrance, and the wipe. */
const PAGE_FRAMES: Readonly<Record<string, string>> = {
  "lively-page": "from { opacity: 0; translate: 0 calc(var(--lively-rise) / 2); }",
  "lively-page-w": "from { opacity: 0; translate: calc(var(--lively-rise) * 0.8) calc(var(--lively-rise) / 2); }",
  "lively-wipe": "0% { translate: 140% 0; } 40%, 65% { translate: 0 0; } 100% { translate: -140% 0; }",
};
/** Each once for the mount, and again under a new name for a switch: same bodies, same motion. */
const pageKeyframes = Object.entries(PAGE_FRAMES)
  .flatMap(([name, body]) => [`@keyframes ${name} { ${body} }`, `@keyframes ${name}${AGAIN} { ${body} }`])
  .join("\n");

/** The motion layer, each preset's own tokens and effect paint, then the presets' art (art.ts). */
export function buildStylesheet(targets: Targets, presets: ReadonlyArray<Preset> = PRESETS): string {
  return `${motionStylesheet(targets)}${presetMotion(presets)}${buildArtStylesheet(targets, presets)}`;
}

/**
 * A preset's motion character and effect paint, under `data-lively-preset`.
 * - `paint` sets the shared effects' paint properties (the wipe's panel, the
 *   chromatic split's colors); paint, so at every level.
 * - `tokens` lays its tokens over every (style, intensity), recomputing the
 *   derived ones (the spring from its overshoot), at the full level only: a
 *   forced full level, or the system's while it does not ask for less motion.
 *   Reduced motion keeps the reduced tokens whatever the preset.
 */
function presetMotion(presets: ReadonlyArray<Preset>): string {
  const out: Array<string> = [];
  for (const preset of presets) {
    const scope = `:root[${ROOT.preset}="${preset.id}"]`;
    const paint = [
      preset.paint?.wipe === undefined ? "" : `  --lively-wipe-fill: ${preset.paint.wipe.fill};\n  --lively-wipe-mask: ${preset.paint.wipe.mask};`,
      preset.paint?.chroma === undefined ? "" : `  --lively-chroma-a: ${preset.paint.chroma[0]};\n  --lively-chroma-b: ${preset.paint.chroma[1]};`,
      preset.paint?.wipe?.label === undefined ? "" : `  --lively-wipe-label: ${cssString(preset.paint.wipe.label)};`,
      preset.paint?.wipe?.ink === undefined ? "" : `  --lively-wipe-ink: ${preset.paint.wipe.ink};`,
      preset.lettering === undefined ? "" : `  --lively-letter-font: ${preset.lettering.font};\n  --lively-letter-color: ${preset.lettering.color};`,
      preset.lettering?.chant?.[0] === undefined ? "" : `  --lively-chant: ${cssString(preset.lettering.chant[0])};`,
    ].filter(Boolean);
    if (paint.length > 0) out.push(`${scope}[${ROOT.level}] {\n${paint.join("\n")}\n}`);
    const overrides = preset.tokens;
    if (overrides === undefined || Object.keys(overrides).length === 0) continue;
    const blocks = STYLES.flatMap((style) =>
      INTENSITIES.map((intensity) => {
        const at = (source: string) =>
          `${scope}[${ROOT.level}="full"][${ROOT.source}="${source}"][${ROOT.intensity}="${intensity}"]:where([${ROOT.style}="${style}"])`;
        const body = tokenBlock({ ...motionTokens(style, intensity), ...overrides }, jellyName(intensity));
        return { user: `${at("user")} {${body}\n}`, system: `${at("system")} {${body}\n}` };
      }),
    );
    out.push(`/* ${preset.label}'s own tokens. */
${blocks.map((block) => block.user).join("\n")}
@media (prefers-reduced-motion: no-preference) {
${blocks.map((block) => block.system).join("\n")}
}`);
  }
  return out.length === 0 ? "" : `/* Preset motion (domain/presets.ts tokens, paint). */\n${out.join("\n")}\n`;
}

function motionStylesheet(targets: Targets): string {
  const suspend = targets.suspendOn.map((attribute) => `:not([${attribute}])`).join("");
  /** The root scope of one effect: on, and nothing is measuring. */
  const on = (effect: EffectId) => `:root[${effectAttribute(effect)}]${suspend}`;
  /** The same, at the full level only (loops never run reduced). */
  const onFull = (effect: EffectId) => `:root[${ROOT.level}="full"][${effectAttribute(effect)}]${suspend}`;
  /** An effect's wobbly variant: full level only, so reduced motion is the clean fades. */
  const wobbly = (effect: EffectId) => `:root[${ROOT.level}="full"][${ROOT.style}="wobbly"][${effectAttribute(effect)}]${suspend}`;
  /** Wobbly with skew on. */
  const skewed = (effect: EffectId) =>
    `:root[${ROOT.level}="full"][${ROOT.style}="wobbly"][${ROOT.skew}="on"][${effectAttribute(effect)}]${suspend}`;
  /** Stickers on, in either style. */
  const stickered = (effect: EffectId) => `:root[${ROOT.stickers}="on"][${effectAttribute(effect)}]${suspend}`;
  /** The thread window on its first mount, and when a switch replays its entrance. */
  const mounted = `${is(targets.pageView)}:not([${PAGE_REPLAYED}])`;
  const replayed = `${is(targets.pageView)}.${CLASSES.page}`;
  /** Wobbly and stickers together (outweighs both). */
  const wobblyStickered = (effect: EffectId) =>
    `:root[${ROOT.level}="full"][${ROOT.style}="wobbly"][${ROOT.stickers}="on"][${effectAttribute(effect)}]${suspend}`;
  const reducedRoot = `:root[${ROOT.level}="reduced"]`;
  /** A page view while it holds a request waiting for the person, and its timeline then. */
  const waiting = `${is(targets.pageView)}:has(${is(targets.pendingRequest)})`;
  const frozen = `${waiting} ${is(targets.rowList)}`;
  const systemRoot = `:root[${ROOT.source}="system"]`;
  /** An effect's CSS half while lively's HTML-in-Canvas layer does not draw it (canvas effects only). */
  const noCanvas = (effect: EffectId) => `${onFull(effect)}:not([${ROOT.canvas}])`;

  const blocks = STYLES.flatMap((style) =>
    INTENSITIES.map(
      (intensity) =>
        // The style sits in :where() so a block weighs what an intensity alone did: the
        // reduced and media-query blocks after it must still win.
        `:root[${ROOT.intensity}="${intensity}"]:where([${ROOT.style}="${style}"]) {${tokenBlock(motionTokens(style, intensity), jellyName(intensity))}\n}`,
    ),
  ).join("\n");
  const reducedTokens = tokenBlock(REDUCED_TOKENS, jellyName("lively"));

  const pressTarget = `${is(targets.pressable)}:not(${is(targets.pressExclude)}):not(:disabled)`;

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
  --lively-delay: calc(var(--lively-stagger) * 0);
  --lively-ease-out: ${springEasing({ overshoot: 0 })};
  --lively-ease-in: ${exitEasing()};
  /* Wobbly's hard stop (ZZZ's tab cut), the ease between jelly stops, and the jelly in use. */
  --lively-snap: ${snapEasing()};
  --lively-jelly-ease: cubic-bezier(0.3, 0, 0.4, 1);
  --lively-jelly: ${jellyName("lively")};
  /* A hover shadow tweens with the lift; a sticker shadow snaps in. */
  --lively-filter-time: var(--lively-overlay);
  --lively-filter-ease: var(--lively-spring);
  /* One accent, the theme's: the Lively themes and any other palette alike. */
  --lively-accent: var(--primary, #7c6cf0);
  --lively-accent-2: var(--timeline-accent, var(--lively-accent));
  /* Derived from the tokens, not numbers of their own. */
  --lively-pop-from: calc(var(--lively-press-scale) * var(--lively-overlay-scale) * var(--lively-overlay-scale));
  --lively-check-from: calc(var(--lively-press-scale) * var(--lively-overlay-scale));
  --lively-exit-scale: calc((1 + var(--lively-overlay-scale)) / 2);
  /* Status rings sit on rows about three times wider than tall, inside a list that clips
     sideways: growing x a third as much grows the ring by about the same pixels each way. */
  --lively-ring-scale-x: calc(1 + (var(--lively-ring-scale) - 1) / 3);
  --lively-glow-color: color-mix(in oklab, var(--lively-accent) calc(var(--lively-glow) * 100%), transparent);
  /* The shared effects' paint; a preset may recolor and reshape them (presets.ts paint). */
  --lively-chroma-a: #3fd4ff;
  --lively-chroma-b: #ff3dbb;
  --lively-wipe-fill: radial-gradient(circle, color-mix(in oklab, #000 24%, transparent) 1px, transparent 1.5px) 0 0 / 6px 6px, var(--lively-accent);
  --lively-wipe-mask: linear-gradient(105deg, transparent 18%, #000 18% 82%, transparent 82%);
  --lively-wipe-label: "";
  --lively-wipe-ink: var(--canvas, Canvas);
  /* The preset's lettering (presets.ts lettering): tracked capitals in its face and color. */
  --lively-letter-font: var(--font-sans, sans-serif);
  --lively-letter-color: var(--lively-accent-2);
  /* A send (domain/send.ts): its form's length, and how far in a swapped row carries on. */
  --lively-send-k: 1;
  --lively-send-span: calc(var(--lively-enter) * var(--lively-send-k));
  --lively-send-delay: 0ms;
}
${SEND_FORMS.map((form) => `:root[${ROOT.send}="${form}"] { --lively-send-k: ${SEND_FORM_INFO[form].span}; }`).join("\n")}
:root[${ROOT.send}="dust"] {
  --lively-dust: var(--lively-art-dust, color-mix(in oklab, var(--ink, CanvasText) 50%, var(--canvas, Canvas)));
  --lively-dust-ember: var(--lively-art-hiss, var(--destructive, #e01b24));
}
:root[${ROOT.speed}="snappy"] { --lively-speed: 0.8; }
:root[${ROOT.speed}="relaxed"] { --lively-speed: 1.25; }
:root[${ROOT.jelly}="matched"] { --lively-jelly: var(--lively-jelly-own); }
:root[${ROOT.stickers}="on"] {
  --lively-filter-time: var(--lively-exit);
  --lively-filter-ease: steps(2, end);
}
${blocks}
${reducedRoot} {${reducedTokens}
}
/* A stale "full" never animates for someone whose OS asks for less motion. */
@media (prefers-reduced-motion: reduce) {
  ${systemRoot} {${reducedTokens}
  }
  ${systemRoot} ${is(targets.overlayOpen)} {
    --tw-enter-translate-x: 0;
    --tw-enter-translate-y: 0;
  }
  ${systemRoot} ${is(targets.focusBox)}:focus-within::after,
  ${systemRoot} ${is(targets.working)},
  ${systemRoot} .${CLASSES.pulse} { animation: none; }
}

@keyframes lively-press-in { to { scale: var(--lively-press-scale); } }
@keyframes lively-press-out { from { scale: var(--lively-press-scale); } to { scale: 1; } }
@keyframes lively-enter {
  from { opacity: 0; translate: 0 var(--lively-rise); filter: blur(var(--lively-blur)); }
  to { opacity: 1; translate: 0 0; filter: blur(0); }
}
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

/* Wobbly keyframes (docs/research/2026-10-24-bb-lively-zzz-wobble.md §3.3). */
@keyframes lively-squash-in {
  to { scale: calc(var(--lively-press-scale) + var(--lively-squash) * 0.6) calc(var(--lively-press-scale) - var(--lively-squash) * 0.4); }
}
${INTENSITIES.map(jellyKeyframes).join("\n")}
@keyframes lively-swell {
  0%, 30% { scale: 1; }
  62% { scale: calc(1 + var(--lively-swell) * var(--lively-swell-x, 1)) calc(1 + var(--lively-swell)); }
  100% { scale: 1; }
}
@keyframes lively-enter-w {
  from { opacity: 0; translate: calc(var(--lively-rise) * 1.6) var(--lively-rise); filter: brightness(calc(1 + var(--lively-flash))); }
  30% { opacity: 1; }
  to { translate: 0 0; filter: brightness(1); }
}
@keyframes lively-skew-in { from { transform: skewX(var(--lively-skew)); } }
@keyframes lively-flash { from { filter: brightness(calc(1 + var(--lively-flash))); } to { filter: brightness(1); } }
@keyframes lively-chroma {
  0%, 100% { filter: none; }
  10% { filter: drop-shadow(var(--lively-chroma) 0 0 var(--lively-chroma-a)) drop-shadow(calc(var(--lively-chroma) * -1) 0 0 var(--lively-chroma-b)); }
  35% { filter: drop-shadow(calc(var(--lively-chroma) * -1) 0 0 var(--lively-chroma-a)) drop-shadow(var(--lively-chroma) 0 0 var(--lively-chroma-b)); }
  50% { filter: none; }
}
@keyframes lively-sticker-pop {
  from { opacity: 0; scale: var(--lively-pop-from); rotate: calc(var(--lively-tilt) * 6); }
  to { opacity: 1; scale: 1; rotate: 0deg; }
}
@keyframes lively-halftone {
  0% { opacity: 0; scale: var(--lively-pop-from); }
  20% { opacity: 1; }
  100% { opacity: 0; scale: var(--lively-ripple-scale); }
}
@keyframes lively-idle { to { scale: calc(1 + var(--lively-swell) / 4); } }
/* turnFreeze: the veil comes up, the Turn() bar fills. */
@keyframes lively-veil { from { opacity: 0; } }
@keyframes lively-turn-bar { from { scale: 0 1; } }
/* glitch: hard sideways jumps, split into the two signal colors, then still. */
@keyframes lively-glitch {
  0% { translate: 0 0; filter: none; }
  12% { translate: var(--lively-tear) 0; filter: drop-shadow(var(--lively-tear) 0 0 var(--lively-chroma-a)) drop-shadow(calc(var(--lively-tear) * -1) 0 0 var(--lively-chroma-b)); }
  30% { translate: calc(var(--lively-tear) * -0.6) 0; filter: drop-shadow(calc(var(--lively-tear) * -1) 0 0 var(--lively-chroma-a)) drop-shadow(var(--lively-tear) 0 0 var(--lively-chroma-b)); }
  46% { translate: calc(var(--lively-tear) * 0.3) 0; filter: none; }
  60%, 100% { translate: 0 0; filter: none; }
}
/* Control: the slabs (shiftWarp's CSS half). */
@keyframes lively-slab {
  from { translate: var(--lively-slab) 0; filter: drop-shadow(calc(var(--lively-chroma) + 3px) 0 0 var(--lively-chroma-a)) drop-shadow(calc(-3px - var(--lively-chroma)) 0 0 var(--lively-chroma-b)); }
  60% { filter: drop-shadow(1px 0 0 var(--lively-chroma-a)) drop-shadow(-1px 0 0 var(--lively-chroma-b)); }
  to { translate: 0 0; filter: none; }
}
${pageKeyframes}

/* press: clean sinks and springs back; wobbly squashes and wobbles back like jelly. */
${on("press")} ${pressTarget}:active {
  animation: lively-press-in var(--lively-press) var(--lively-ease-out) forwards;
}
${on("press")} .${CLASSES.pressOut} {
  animation: lively-press-out var(--lively-release) var(--lively-spring) backwards;
}
${wobbly("press")} ${pressTarget}:active {
  animation: lively-squash-in var(--lively-press) var(--lively-ease-out) forwards;
}
${wobbly("press")} .${CLASSES.pressOut} {
  animation: var(--lively-jelly) var(--lively-release) var(--lively-jelly-ease) backwards;
  transform-origin: 50% 60%;
}

/* hoverLift: a real lift and a soft shadow; wobbly tilts; stickers snap a hard shadow in. */
@media (hover: hover) {
  ${on("hoverLift")} ${is(targets.liftable)} {
    transition-property: translate, rotate, filter, opacity, color, background-color, border-color;
    transition-duration: var(--lively-overlay), var(--lively-overlay), var(--lively-filter-time), var(--lively-overlay), var(--lively-overlay), var(--lively-overlay), var(--lively-overlay);
    transition-timing-function: var(--lively-spring), var(--lively-spring), var(--lively-filter-ease), var(--lively-spring), var(--lively-spring), var(--lively-spring), var(--lively-spring);
  }
  ${on("hoverLift")} ${is(targets.liftable)}:hover {
    translate: 0 var(--lively-lift);
    filter: drop-shadow(0 calc(var(--lively-lift) * -3) calc(var(--lively-lift) * -6) color-mix(in oklab, #000 calc(var(--lively-lift-shadow) * 100%), transparent));
  }
  ${wobbly("hoverLift")} ${is(targets.liftable)}:hover { rotate: var(--lively-tilt); }
  ${stickered("hoverLift")} ${is(targets.liftable)}:hover {
    translate: calc(var(--lively-sticker) * -0.5) calc(var(--lively-sticker) * -0.5);
    filter: drop-shadow(calc(var(--lively-sticker) * 1.5) calc(var(--lively-sticker) * 1.5) 0 var(--lively-accent));
  }
}

/* listEnter: clean rises staggered from a blur; wobbly slaps in from the lower right with a
   flash and settles in bounces, skewing in (composited onto the row's own transform) when
   skew is on; the last row of a batch splits into color for a frame or two. */
${on("listEnter")} .${CLASSES.enter} {
  animation: lively-enter var(--lively-enter) var(--lively-spring) var(--lively-delay) backwards;
  will-change: transform, opacity, filter;
}
${on("listEnter")} .${CLASSES.enter}[${PULSE_ATTRIBUTES.stagger}="1"] { --lively-delay: var(--lively-stagger); }
${on("listEnter")} .${CLASSES.enter}[${PULSE_ATTRIBUTES.stagger}="2"] { --lively-delay: calc(var(--lively-stagger) * 2); }
${on("listEnter")} .${CLASSES.enter}[${PULSE_ATTRIBUTES.stagger}="3"] { --lively-delay: calc(var(--lively-stagger) * 3); }
${wobbly("listEnter")} .${CLASSES.enter} {
  animation: lively-enter-w var(--lively-enter) var(--lively-spring) var(--lively-delay) backwards;
}
${wobbly("listEnter")} .${CLASSES.enter}[${PULSE_ATTRIBUTES.last}] {
  animation:
    lively-enter-w var(--lively-enter) var(--lively-spring) var(--lively-delay) backwards,
    lively-chroma calc(var(--lively-pulse) / 2) steps(1, end) var(--lively-delay);
}
${skewed("listEnter")} .${CLASSES.enter} {
  animation:
    lively-enter-w var(--lively-enter) var(--lively-spring) var(--lively-delay) backwards,
    lively-skew-in var(--lively-enter) var(--lively-spring) var(--lively-delay) backwards;
  animation-composition: replace, add;
  transform-origin: 0 100%;
}
${skewed("listEnter")} .${CLASSES.enter}[${PULSE_ATTRIBUTES.last}] {
  animation:
    lively-enter-w var(--lively-enter) var(--lively-spring) var(--lively-delay) backwards,
    lively-skew-in var(--lively-enter) var(--lively-spring) var(--lively-delay) backwards,
    lively-chroma calc(var(--lively-pulse) / 2) steps(1, end) var(--lively-delay);
  animation-composition: replace, add, replace;
  transform-origin: 0 100%;
}

/* pageEnter: a thread's window eases in when it mounts; wobbly bounces in from the lower right.
   bb keeps the window mounted across a thread switch, so a switch replays the entrance
   through a class, under copies of the keyframes (a new name is what restarts a CSS animation). */
${on("pageEnter")} ${mounted} {
  animation: lively-page var(--lively-enter) var(--lively-ease-out) backwards;
}
${wobbly("pageEnter")} ${mounted} {
  animation: lively-page-w var(--lively-enter) var(--lively-spring) backwards;
}
${on("pageEnter")} ${replayed} {
  animation: lively-page${AGAIN} var(--lively-enter) var(--lively-ease-out) backwards;
}
${wobbly("pageEnter")} ${replayed} {
  animation: lively-page-w${AGAIN} var(--lively-enter) var(--lively-spring) backwards;
}

/* pageWipe (either style, full level): ZZZ's slanted, dotted panel (or the preset's own) sweeps across the
   thread as it mounts. The slant is a mask, not a skew, so only translate moves; the
   window already clips its overflow, and positioning it moves none of its children.
   It runs as long as the entrance, so the replay's one class ends with both. */
${onFull("pageWipe")} ${is(targets.pageView)} { position: relative; }
${onFull("pageWipe")} ${is(targets.pageView)}::after {
  content: var(--lively-wipe-label);
  display: grid;
  place-items: center;
  font: 600 22px/1 var(--lively-letter-font);
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--lively-wipe-ink);
  position: absolute;
  inset: 0 -40%;
  z-index: 60;
  pointer-events: none;
  background: var(--lively-wipe-fill);
  mask: var(--lively-wipe-mask);
  translate: 140% 0;
}
${onFull("pageWipe")} ${mounted}::after {
  animation: lively-wipe var(--lively-enter) linear backwards;
}
${onFull("pageWipe")} ${replayed}::after {
  animation: lively-wipe${AGAIN} var(--lively-enter) linear backwards;
}

/* focusRing: a glow drawn once on a pseudo-element; its opacity moves, and breathes at full
   level. Wobbly: a solid ring snaps in and swells once (ZZZ's tab: cut, then swell). */
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
${stickered("focusRing")} ${is(targets.focusBox)}::after {
  box-shadow:
    0 0 0 1px color-mix(in oklab, var(--lively-accent) 55%, transparent),
    0 0 calc(var(--lively-glow) * 28px) calc(var(--lively-glow) * 6px) var(--lively-glow-color),
    var(--lively-sticker) var(--lively-sticker) 0 0 #000;
}
${wobbly("focusRing")} ${is(targets.focusBox)}::after {
  box-shadow: 0 0 0 2px var(--lively-accent);
  transition: opacity var(--lively-exit) steps(2, end);
}
${wobblyStickered("focusRing")} ${is(targets.focusBox)}::after {
  box-shadow: 0 0 0 2px var(--lively-accent), var(--lively-sticker) var(--lively-sticker) 0 2px #000;
}
${wobbly("focusRing")} ${is(targets.focusBox)}:focus-within::after {
  animation:
    lively-swell var(--lively-pulse) var(--lively-ease-out),
    lively-breathe var(--lively-breathe) var(--lively-ease-out) var(--lively-overlay) infinite alternate;
}

/* sendPulse: a ripple, and at lively and bold a burst of sparks in the accents.
   Wobbly: a halftone comic burst ring, and the icon pops in like a sticker. */
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
${wobbly("sendPulse")} .${CLASSES.send}::after {
  inset: -14px;
  border-radius: 50%;
  box-shadow: none;
  background: radial-gradient(circle, var(--lively-accent) 1.4px, transparent 1.8px) 0 0 / 6px 6px;
  mask: radial-gradient(circle, transparent 38%, #000 40% 62%, transparent 70%);
  animation: lively-halftone var(--lively-pulse) var(--lively-ease-out);
}
${wobbly("sendPulse")} ${is(targets.sendIcon)} {
  animation: lively-sticker-pop var(--lively-overlay) var(--lively-spring) backwards;
}
${sendStylesheet(on, suspend)}
/* statusPulse: two rings in a gradient of the status color, with a soft halo.
   Wobbly: the rings land hard once; the row splits into color and swells; a failure shudders. */
${on("statusPulse")} .${CLASSES.pulse} { --lively-tone: var(--lively-accent); }
${on("statusPulse")} .${CLASSES.pulse}[${PULSE_ATTRIBUTES.tone}="success"] { --lively-tone: var(--success, #3ecf8e); }
${on("statusPulse")} .${CLASSES.pulse}[${PULSE_ATTRIBUTES.tone}="error"] { --lively-tone: var(--destructive, #f2626b); }
${on("statusPulse")} .${CLASSES.pulse}[${PULSE_ATTRIBUTES.tone}="waiting"] { --lively-tone: var(--attention, var(--warning, #e8c547)); }
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
${wobbly("statusPulse")} .${CLASSES.pulse}::after,
${wobbly("statusPulse")} .${CLASSES.pulse}::before {
  animation: lively-ring var(--lively-pulse) var(--lively-snap);
}
${wobbly("statusPulse")} .${CLASSES.pulse} {
  /* Rows are wide in a list that clips sideways: swell and shudder mostly vertically. */
  --lively-swell-x: 0.33;
  --lively-squash-k: 0.35;
  animation:
    lively-chroma calc(var(--lively-pulse) / 2) steps(1, end),
    lively-swell var(--lively-pulse) var(--lively-ease-out);
}
${wobbly("statusPulse")} .${CLASSES.pulse}[${PULSE_ATTRIBUTES.tone}="error"] {
  animation:
    lively-chroma calc(var(--lively-pulse) / 2) steps(1, end),
    var(--lively-jelly) var(--lively-release) var(--lively-jelly-ease);
}

/* toastSpring: sonner's transitions are transform, opacity, height, box-shadow, in that order.
   Retimed only (the wobbly spring bounces the slide-in): sonner drives transform and its own
   swipe animations, so lively never animates a toast. Stickers add a static hard shadow. */
${on("toastSpring")} ${is(targets.toast)} {
  transition-duration: var(--lively-enter), var(--lively-overlay), var(--lively-enter), var(--lively-overlay);
  transition-timing-function: var(--lively-spring), var(--lively-ease-out), var(--lively-ease-out), var(--lively-ease-out);
}
${stickered("toastSpring")} ${is(targets.toast)} {
  filter: drop-shadow(var(--lively-sticker) var(--lively-sticker) 0 #000);
}

/* overlayEnter: retime the host's own enter/exit keyframes through their per-element variables.
   Wobbly opens from a tilt (dialogs half as much) and snaps shut smaller. */
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
${wobbly("overlayEnter")} ${is(targets.overlayOpen)} { --tw-enter-rotate: calc(var(--lively-tilt) * 2); }
${wobbly("overlayEnter")} ${is(targets.dialogOpen)} { --tw-enter-rotate: var(--lively-tilt); }
${wobbly("overlayEnter")} ${is(targets.overlayClosed)} { --tw-exit-scale: var(--lively-exit-scale); }
${stickered("overlayEnter")} ${is(targets.overlayOpen)} {
  filter: drop-shadow(var(--lively-sticker) var(--lively-sticker) 0 var(--lively-accent));
}

/* toggles: switch thumbs ride the spring (wobbly's bounces as it lands); a ticked checkbox
   pops, and under wobbly pops like a sticker with a flash. */
${on("toggles")} ${is(targets.switchThumb)} {
  transition-duration: var(--lively-release);
  transition-timing-function: var(--lively-spring);
}
${on("toggles")} .${CLASSES.check} {
  animation: lively-check var(--lively-release) var(--lively-spring) backwards;
}
${wobbly("toggles")} .${CLASSES.check} {
  animation:
    lively-sticker-pop var(--lively-release) var(--lively-spring) backwards,
    lively-flash var(--lively-release) var(--lively-ease-out) backwards;
}

/* workingGlow: the host's working line breathes an accent glow (full level only); wobbly
   also breathes in scale, like a character's idle loop. */
${onFull("workingGlow")} ${is(targets.working)} {
  animation: lively-working var(--lively-breathe) var(--lively-ease-out) infinite alternate;
}
${wobbly("workingGlow")} ${is(targets.working)} {
  animation:
    lively-working var(--lively-breathe) var(--lively-ease-out) infinite alternate,
    lively-idle var(--lively-breathe) ease-in-out infinite alternate;
}

/* turnFreeze (Cloudbank's Turn()): while the page view holds a request waiting for the person,
   its timeline freezes into a dim cyan plan (the rows dim and tint; a grid veil and a dashed
   plan line come up behind them) and the request lights up as a Turn() bar fills along its top.
   A state, so it shows at every level; at the full level it comes in on steps and thaws on the
   ease. The request sits outside the timeline, so it never freezes. */
${on("turnFreeze")} ${frozen} > ${is(targets.row)} {
  filter: saturate(0.3) sepia(0.35) hue-rotate(135deg) opacity(0.62);
}
${on("turnFreeze")} ${frozen}::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    repeating-linear-gradient(to bottom, var(--lively-accent) 0 6px, transparent 6px 12px) 2px 0 / 2px 100% no-repeat,
    linear-gradient(to right, color-mix(in oklab, var(--lively-accent) 8%, transparent) 1px, transparent 1px) 0 0 / 24px 24px,
    linear-gradient(to bottom, color-mix(in oklab, var(--lively-accent) 8%, transparent) 1px, transparent 1px) 0 0 / 24px 24px,
    color-mix(in oklab, var(--lively-accent) 5%, transparent);
}
${on("turnFreeze")} ${waiting} ${is(targets.pendingRequest)} {
  position: relative;
  /* Opaque while lit: the art behind the dock never runs through the request. */
  background-color: var(--card, var(--background, Canvas));
  border-color: var(--lively-accent);
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--lively-accent) 45%, transparent), 0 0 calc(var(--lively-glow) * 40px) var(--lively-glow-color);
}
/* The Turn() bar: eight segments along the request's top edge, in the sword's light. */
${on("turnFreeze")} ${waiting} ${is(targets.pendingRequest)}::after {
  content: "";
  position: absolute;
  inset: 3px 8px auto;
  height: 4px;
  pointer-events: none;
  background: repeating-linear-gradient(to right, var(--lively-accent) 0 calc(12.5% - 3px), transparent calc(12.5% - 3px) 12.5%);
  filter: drop-shadow(0 0 calc(var(--lively-glow) * 12px) var(--lively-accent));
  transform-origin: 0 50%;
}
/* Its name, as the game writes its functions: Turn(), in the preset's lettering. */
${on("turnFreeze")} ${waiting} ${is(targets.pendingRequest)}::before {
  content: "Turn()";
  position: absolute;
  top: 12px;
  right: 44px;
  pointer-events: none;
  font: 600 10px/1 var(--lively-letter-font);
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--lively-letter-color);
}
${onFull("turnFreeze")} ${is(targets.rowList)} > ${is(targets.row)} {
  transition: filter var(--lively-enter) var(--lively-ease-out);
}
${onFull("turnFreeze")} ${frozen} > ${is(targets.row)} {
  transition: filter var(--lively-overlay) steps(3, end);
}
${onFull("turnFreeze")} ${frozen}::before {
  animation: lively-veil var(--lively-overlay) steps(3, end) backwards;
}
${onFull("turnFreeze")} ${waiting} ${is(targets.pendingRequest)}::after {
  animation: lively-turn-bar calc(var(--lively-enter) * 1.4) steps(8, end) var(--lively-overlay) backwards;
}

/* glitch (YoRHa): a failed thread's row tears sideways in hard steps, in the two signal colors.
   The tear is a third of the rise, so it scales with the intensity. */
${onFull("glitch")} .${CLASSES.pulse}[${PULSE_ATTRIBUTES.tone}="error"] {
  --lively-tear: calc(var(--lively-rise) / 3);
  animation: lively-glitch var(--lively-pulse) steps(1, end);
}

/* shiftWarp (Control: the Oldest House rearranging). The canvas layer breaks the thread you leave into
   slabs; this CSS half, without it, assembles the thread you open: its rows slide in from alternating
   sides as slabs, in hard steps, split into the preset's two dispersion colors. As long as the
   entrance, which ends the replay class. */
${noCanvas("shiftWarp")} ${replayed} ${is(targets.rowList)} > ${is(targets.row)} {
  --lively-slab: calc(var(--lively-rise) * -2.4);
  animation: lively-slab var(--lively-enter) steps(4, end) backwards;
}
${noCanvas("shiftWarp")} ${replayed} ${is(targets.rowList)} > ${is(targets.row)}:nth-child(even) {
  --lively-slab: calc(var(--lively-rise) * 2.4);
}

/* hissResonance (Control: the Hiss). While the open thread waits for the person, the timeline takes a
   red cast (still readable), a red resonance veil comes up behind it, and the request card burns Hiss
   red with the preset's chant printed doubled over itself in its corner. A state, so at every level,
   and still (no loop); the canvas layer adds rippling red echoes of the card and the chant in the
   margins on top of this. */
${on("hissResonance")} { --lively-hiss: var(--lively-art-hiss, var(--destructive, #e01b24)); }
${on("hissResonance")} ${frozen} > ${is(targets.row)} {
  filter: sepia(0.3) saturate(1.3) hue-rotate(-24deg) brightness(0.94);
}
${on("hissResonance")} ${frozen}::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    repeating-linear-gradient(to bottom, color-mix(in oklab, var(--lively-hiss) 7%, transparent) 0 1px, transparent 1px 5px),
    radial-gradient(120% 60% at 50% 100%, color-mix(in oklab, var(--lively-hiss) 12%, transparent), transparent 70%);
}
${on("hissResonance")} ${waiting} ${is(targets.pendingRequest)} {
  position: relative;
  background-color: var(--card, var(--background, Canvas));
  border-color: var(--lively-hiss);
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--lively-hiss) 50%, transparent), 0 0 calc(var(--lively-glow) * 48px) color-mix(in oklab, var(--lively-hiss) 40%, transparent);
}
${on("hissResonance")} ${waiting} ${is(targets.pendingRequest)}::before {
  content: var(--lively-chant, "");
  position: absolute;
  top: 12px;
  right: 44px;
  pointer-events: none;
  font: 700 10px/1 var(--lively-letter-font);
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--lively-hiss);
  text-shadow: 3px 0 0 color-mix(in oklab, var(--lively-hiss) 45%, transparent), -4px 1px 0 color-mix(in oklab, var(--lively-hiss) 28%, transparent), 9px -1px 0 color-mix(in oklab, var(--lively-hiss) 16%, transparent);
}
${onFull("hissResonance")} ${frozen}::before {
  animation: lively-veil var(--lively-overlay) steps(3, end) backwards;
}

/* typingGlow */
${on("typingGlow")} .${CLASSES.typing} { caret-color: var(--lively-accent); }

/* calmHost: set only under reduced motion (the policy). */
${on("calmHost")} ${is(targets.hostAnimation)} { animation: none !important; }
`;
}

/** A 4×4 ordered-dither matrix: the order the Process's cells blank out in. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;
/** One third of a 32px tile's 8px cells, by dither order, as a mask: three of them whitewash a box in three steps. */
function cellMask(third: number): string {
  const cells = BAYER.flatMap((rank, index) => (Math.floor((rank * 3) / 16) === third ? [`M${(index % 4) * 8} ${Math.floor(index / 4) * 8}h8v8h-8z`] : []));
  return `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><path d='${cells.join("")}'/></svg>") 0 0 / 32px 32px`;
}
/** The Process's blank cells: Process white, ruled in the accent. */
const CELLS =
  "linear-gradient(90deg, color-mix(in oklab, var(--lively-accent) 45%, transparent) 1px, transparent 1px) 0 0 / 8px 8px, linear-gradient(color-mix(in oklab, var(--lively-accent) 45%, transparent) 1px, transparent 1px) 0 0 / 8px 8px, var(--lively-art-process, #f2efe6)";
/** A scan bar: a 2px rule in the ink with scanlines above it. */
const SCAN_BAR =
  "linear-gradient(to bottom, transparent 0 9px, var(--lively-accent) 9px 11px, transparent 11px), repeating-linear-gradient(to bottom, color-mix(in oklab, var(--lively-accent) 22%, transparent) 0 1px, transparent 1px 3px) 0 0 / 100% 9px no-repeat";

/** A pseudo-element over the message's own box in its row. */
const onBubble = (inflate: string) => `  content: "";
  position: absolute;
  left: calc(var(--lively-bx) - ${inflate});
  top: calc(var(--lively-by) - ${inflate});
  width: calc(var(--lively-bw) + ${inflate} * 2);
  height: calc(var(--lively-bh) + ${inflate} * 2);
  pointer-events: none;`;

/**
 * sendPulse's sequence (domain/send.ts, dom/send.ts): the ghost of the words leaving the composer,
 * the echo landing along the path from them (`--lively-send-dx/-dy`, the bubble's box in its row as
 * `--lively-bx/-by/-bw/-bh`), and the turn's first reply landing where it is. At every level the
 * ghost fades and the message comes in as listEnter does (a fade under reduced motion); at the full
 * level each form is its own art. Only composited properties move; pseudo-elements and the ghost's
 * three layers carry the rest.
 */
function sendStylesheet(on: (effect: EffectId) => string, suspend: string): string {
  const base = on("sendPulse");
  const form = (name: SendForm) => `:root[${ROOT.level}="full"][${ROOT.send}="${name}"][${effectAttribute("sendPulse")}]${suspend}`;
  const skewedSlap = `:root[${ROOT.level}="full"][${ROOT.send}="slap"][${ROOT.skew}="on"][${effectAttribute("sendPulse")}]${suspend}`;
  const ghost = `[${GHOST_ATTRIBUTE}]`;
  const leaving = `${ghost}.${CLASSES.depart}`;
  const words = `${leaving} > [${GHOST_ATTRIBUTE}-words]`;
  const layer = (n: number) => `${leaving} > [${GHOST_ATTRIBUTE}-layer="${n}"]`;
  const landing = `:is(.${CLASSES.arrive}, .${CLASSES.reply})`;
  const drawn = `${landing}[${DRAWN_ATTRIBUTE}]`;
  const dx = "var(--lively-send-dx, 0px)";
  const dy = "var(--lively-send-dy, 0px)";
  const keyframes = `
@keyframes lively-depart {
  from { opacity: 1; translate: 0 0; filter: blur(0); }
  55% { opacity: 0; }
  to { opacity: 0; translate: calc(${dx} * var(--lively-travel)) calc(${dy} * var(--lively-travel)); filter: blur(var(--lively-blur)); }
}
@keyframes lively-glide-in {
  from { opacity: 0; translate: calc(${dx} * var(--lively-travel)) calc(${dy} * var(--lively-travel) + var(--lively-rise)); filter: blur(var(--lively-blur)); }
  40% { opacity: 1; }
  to { opacity: 1; translate: 0 0; filter: blur(0); }
}
@keyframes lively-slap-out {
  0% { opacity: 1; translate: 0 0; filter: brightness(calc(1 + var(--lively-flash))); }
  24% { opacity: 1; translate: calc(${dx} * 0.2) calc(${dy} * 0.2); filter: drop-shadow(var(--lively-chroma) 0 0 var(--lively-chroma-a)) drop-shadow(calc(var(--lively-chroma) * -1) 0 0 var(--lively-chroma-b)); }
  25%, 100% { opacity: 0; translate: calc(${dx} * 0.2) calc(${dy} * 0.2); filter: none; }
}
@keyframes lively-slap-in {
  from { opacity: 0; translate: calc(${dx} * var(--lively-travel)) calc(${dy} * var(--lively-travel)); filter: brightness(calc(1 + var(--lively-flash))) drop-shadow(var(--lively-sticker) var(--lively-sticker) 0 var(--lively-accent)); }
  20% { opacity: 1; }
  to { opacity: 1; translate: 0 0; filter: brightness(1) drop-shadow(0 0 0 transparent); }
}
@keyframes lively-hide { from, to { opacity: 0; } }
@keyframes lively-show { from, to { opacity: 1; } }
@keyframes lively-process-out {
  0%, 45% { opacity: 1; translate: 0 0; }
  100% { opacity: 0; translate: calc(${dx} * var(--lively-travel) * 0.5) calc(${dy} * var(--lively-travel) * 0.5); }
}
@keyframes lively-process-in {
  from { opacity: 0; translate: calc(${dx} * var(--lively-travel)) calc(${dy} * var(--lively-travel)); }
  30% { opacity: 1; }
  to { opacity: 1; translate: 0 0; }
}
@keyframes lively-trace {
  0% { opacity: 1; scale: 1 0; }
  35% { opacity: 1; scale: 1 1; }
  100% { opacity: 0; scale: 1 1; }
}
@keyframes lively-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes lively-scan-out {
  0%, 62% { opacity: 1; translate: 0 0; }
  100% { opacity: 0; translate: calc(${dx} * var(--lively-travel) * 0.15) calc(${dy} * var(--lively-travel) * 0.15); }
}
@keyframes lively-scan-bar { from { translate: 0 -12px; } to { translate: 0 var(--lively-gh); } }
@keyframes lively-scan-cover { from { scale: 1 0; } to { scale: 1 1; } }
@keyframes lively-scan-in {
  from { opacity: 0; translate: calc(${dx} * var(--lively-travel) * 0.12) calc(${dy} * var(--lively-travel) * 0.12 + var(--lively-rise)); }
  10% { opacity: 1; }
  40%, 100% { opacity: 1; translate: 0 0; }
}
@keyframes lively-scan-uncover { from { scale: 1 1; } to { scale: 1 0; } }
@keyframes lively-scan-ride { from { opacity: 1; translate: 0 -6px; } to { opacity: 1; translate: 0 calc(var(--lively-bh) - 6px); } }
@keyframes lively-blink { from { opacity: 1; } to { opacity: 0; } }
@keyframes lively-dust-out {
  from { opacity: 1; translate: 0 0; filter: blur(0) drop-shadow(0 0 0 var(--lively-chroma-a)) drop-shadow(0 0 0 var(--lively-chroma-b)); }
  to { opacity: 0; translate: calc(var(--lively-rise) * 3) calc(var(--lively-rise) * -9); filter: blur(calc(var(--lively-blur) * 3 + 2px)) drop-shadow(calc(var(--lively-chroma) + 2px) 0 0 var(--lively-chroma-a)) drop-shadow(calc(-2px - var(--lively-chroma)) 0 0 var(--lively-chroma-b)); }
}
@keyframes lively-dust-grain {
  from { opacity: 0; translate: 0 0; filter: blur(0); }
  25% { opacity: 0.85; }
  to { opacity: 0; translate: calc(var(--lively-rise) * 5) calc(var(--lively-rise) * -16); filter: blur(calc(var(--lively-blur) + 1px)); }
}
@keyframes lively-dust-in {
  from { opacity: 0; translate: calc(${dx} * var(--lively-travel) * 0.1) calc(${dy} * var(--lively-travel) * 0.25 + var(--lively-rise) * 2); filter: blur(calc(var(--lively-blur) * 4 + 2px)); }
  55% { opacity: 0.9; }
  to { opacity: 1; translate: 0 0; filter: blur(0); }
}
@keyframes lively-dust-reveal {
  0%, 80% { opacity: 0; filter: blur(calc(var(--lively-blur) * 2)); }
  100% { opacity: 1; filter: blur(0); }
}
@keyframes lively-motes {
  from { opacity: 0; translate: 0 0; filter: blur(0); }
  20% { opacity: 1; }
  to { opacity: 0; translate: calc(var(--lively-rise) * 1.5) calc(var(--lively-rise) * -4); filter: blur(2px); }
}`;
  return `${keyframes}

/* sendPulse, every level: the ghost fades on its way, the message comes in as a row does. */
${base} ${ghost} > [${GHOST_ATTRIBUTE}-layer] { position: absolute; inset: 0; pointer-events: none; opacity: 0; }
${base} ${leaving} { animation: lively-depart var(--lively-enter) var(--lively-ease-out) backwards; }
${base} ${landing} { animation: lively-enter var(--lively-enter) var(--lively-spring) var(--lively-send-delay) backwards; }
${base} ${ghost}[${DRAWN_ATTRIBUTE}] { visibility: hidden; }

/* glide (clean): the words and the message travel one path together, crossing over as they go. */
${form("glide")} ${leaving} { animation: lively-depart var(--lively-send-span) var(--lively-spring) backwards; }
${form("glide")} ${landing} { animation: lively-glide-in var(--lively-send-span) var(--lively-spring) var(--lively-send-delay) backwards; }

/* slap (wobbly, ZZZ): the words jump once and cut; the message slaps in with a flash and a sticker
   shadow, skewing in when skew is on, over a halftone pop behind it. */
${form("slap")} ${leaving} { animation: lively-slap-out var(--lively-send-span) linear backwards; }
${form("slap")} ${landing} {
  position: relative;
  isolation: isolate;
  animation: lively-slap-in var(--lively-send-span) var(--lively-spring) var(--lively-send-delay) backwards;
}
${skewedSlap} ${landing} {
  animation:
    lively-slap-in var(--lively-send-span) var(--lively-spring) var(--lively-send-delay) backwards,
    lively-skew-in var(--lively-send-span) var(--lively-spring) var(--lively-send-delay) backwards;
  animation-composition: replace, add;
  transform-origin: 0 100%;
}
${form("slap")} ${landing}::before {
${onBubble("14px")}
  z-index: -1;
  background: radial-gradient(circle, var(--lively-accent) 1.4px, transparent 1.8px) 0 0 / 7px 7px;
  mask: radial-gradient(closest-side, #000 40%, transparent);
  opacity: 0;
  animation: lively-halftone var(--lively-pulse) var(--lively-ease-out) var(--lively-send-delay);
}

/* process (Cloudbank): the words whitewash into the Process's cells in three dithered steps, then
   jaunt toward the thread; the message comes along the path in steps under a veil of cells, a
   turquoise trace drawn up to it from the composer. The button throws function sparks. */
${form("process")} ${leaving} { animation: lively-process-out var(--lively-send-span) steps(4, end) backwards; }
${form("process")} ${words} { opacity: 0; animation: lively-fade-out calc(var(--lively-send-span) * 0.4) steps(3, end) backwards; }
${[1, 2, 3]
  .map(
    (n) => `${form("process")} ${layer(n)} {
  background: ${CELLS};
  mask: ${cellMask(n - 1)};
  opacity: 1;
  animation: lively-hide calc(var(--lively-send-span) * ${(0.08 * n).toFixed(2)}) linear backwards;
}`,
  )
  .join("\n")}
${form("process")} ${landing} {
  position: relative;
  isolation: isolate;
  animation: lively-process-in var(--lively-send-span) steps(6, end) var(--lively-send-delay) backwards;
}
${form("process")} ${landing}::after {
${onBubble("0px")}
  z-index: 1;
  background: ${CELLS};
  opacity: 0;
  animation: lively-fade-out calc(var(--lively-send-span) * 0.7) steps(4, end) var(--lively-send-delay);
}
${form("process")} ${landing}::before {
  content: "";
  position: absolute;
  left: calc(var(--lively-bx) + var(--lively-bw) - 10px);
  top: calc(var(--lively-by) + var(--lively-bh));
  width: 2px;
  height: max(0px, calc(var(--lively-send-dy, 0px) - var(--lively-bh)));
  pointer-events: none;
  background: var(--lively-accent);
  filter: drop-shadow(0 0 calc(var(--lively-glow) * 20px) var(--lively-accent));
  transform-origin: 50% 100%;
  opacity: 0;
  animation: lively-trace calc(var(--lively-send-span) * 0.8) var(--lively-ease-out) var(--lively-send-delay);
}
${form("process")} .${CLASSES.send}::after {
  inset: -16px;
  border-radius: 50%;
  box-shadow: none;
  background: repeating-conic-gradient(var(--lively-accent) 0 5deg, transparent 5deg 30deg, var(--lively-accent-2) 30deg 33deg, transparent 33deg 45deg);
  mask: radial-gradient(circle, transparent 34%, #000 36% 64%, transparent 72%);
  animation: lively-burst var(--lively-pulse) var(--lively-ease-out);
}

/* scan (YoRHa): a scan bar erases the words line by line under the composer's own ground; the
   message prints in under a bar riding down it, a rust marker at the bar's end. Linear, stepped. */
${form("scan")} ${leaving} { animation: lively-scan-out var(--lively-send-span) linear backwards; }
${form("scan")} ${layer(1)} {
  inset: 0 0 auto;
  height: 12px;
  z-index: 1;
  background: ${SCAN_BAR};
  opacity: 1;
  translate: 0 var(--lively-gh);
  animation: lively-scan-bar calc(var(--lively-send-span) * 0.6) steps(6, end) backwards;
}
${form("scan")} ${layer(2)} {
  background: var(--lively-ghost-ground);
  transform-origin: 50% 0;
  opacity: 1;
  animation: lively-scan-cover calc(var(--lively-send-span) * 0.6) steps(6, end) backwards;
}
${form("scan")} ${layer(3)} {
  inset: 4px auto auto 4px;
  width: 6px;
  height: 6px;
  z-index: 2;
  background: var(--lively-accent-2);
  animation: lively-blink calc(var(--lively-send-span) * 0.2) steps(2, jump-none) 3;
}
${form("scan")} ${landing} {
  position: relative;
  isolation: isolate;
  animation: lively-scan-in var(--lively-send-span) linear var(--lively-send-delay) backwards;
}
${form("scan")} ${landing}::after {
${onBubble("0px")}
  z-index: 1;
  background: var(--canvas, var(--background, Canvas));
  transform-origin: 50% 100%;
  scale: 1 0;
  animation: lively-scan-uncover calc(var(--lively-send-span) * 0.75) steps(6, end) var(--lively-send-delay) backwards;
}
${form("scan")} ${landing}::before {
  content: "";
  position: absolute;
  left: calc(var(--lively-bx) - 10px);
  top: var(--lively-by);
  width: calc(var(--lively-bw) + 20px);
  height: 12px;
  z-index: 2;
  pointer-events: none;
  background: linear-gradient(var(--lively-accent-2), var(--lively-accent-2)) 0 3px / 6px 6px no-repeat, ${SCAN_BAR};
  opacity: 0;
  animation: lively-scan-ride calc(var(--lively-send-span) * 0.75) steps(6, end) var(--lively-send-delay);
}
${form("scan")} .${CLASSES.send}::after {
  border-radius: 0;
  box-shadow: 0 0 0 1px var(--lively-accent);
  animation: lively-ripple var(--lively-pulse) steps(3, end);
}
${form("scan")} .${CLASSES.send}::before {
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
  border-radius: 0;
  background: var(--lively-accent-2);
  box-shadow: none;
  animation: lively-blink calc(var(--lively-pulse) / 2) steps(2, jump-none) 2;
}

/* dust (Control, the Hiss): drawn on the canvas layer when it can run (dust.ts), the ghost and the
   message hidden in its stead until the dust settles into the message. Without it: the words blur,
   split into the dispersion colors and drift up and away in a cloud of grain; the message comes into
   focus out of a blur rising from below. The button lets off a few motes, an ember among them. */
${form("dust")} ${leaving} { animation: lively-dust-out var(--lively-send-span) var(--lively-ease-out) backwards; }
${[1, 2]
  .map(
    (n) => `${form("dust")} ${layer(n)} {
  inset: -30% -10%;
  background: radial-gradient(circle, ${n === 1 ? "var(--lively-dust)" : "var(--lively-dust-ember)"} 0.9px, transparent 1.5px) 0 0 / ${n === 1 ? 5 : 11}px ${n === 1 ? 5 : 11}px;
  mask: radial-gradient(closest-side, #000, transparent);
  animation: lively-dust-grain var(--lively-send-span) var(--lively-ease-out) calc(var(--lively-send-span) * ${n === 1 ? 0 : 0.1}) backwards;
}`,
  )
  .join("\n")}
${form("dust")} ${landing} { animation: lively-dust-in var(--lively-send-span) var(--lively-ease-out) var(--lively-send-delay) backwards; }
${form("dust")} ${drawn} { animation: lively-dust-reveal var(--lively-send-span) linear var(--lively-send-delay) backwards; }
${form("dust")} .${CLASSES.send}::after { box-shadow: none; animation: none; }
${form("dust")} .${CLASSES.send}::before {
  width: 3px;
  height: 3px;
  margin: -1.5px 0 0 -1.5px;
  box-shadow:
    6px -2px 0 0 var(--lively-dust),
    -5px -4px 0 0.5px var(--lively-dust),
    1px -9px 0 0 var(--lively-dust-ember),
    -8px 3px 0 0 var(--lively-dust),
    9px 4px 0 0.5px var(--lively-dust),
    -2px -12px 0 0 var(--lively-dust);
  animation: lively-motes calc(var(--lively-pulse) * 2.2) var(--lively-ease-out);
}
`;
}
