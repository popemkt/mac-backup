// The pure domain: settings decoding and the motion policy.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SETTINGS,
  decodeSettings,
  EFFECT_IDS,
  EFFECTS,
  effectAttribute,
  INTENSITIES,
  jellyCoefficients,
  landsAt,
  MOTION_TOKENS,
  REDUCED_TOKENS,
  resolveMotion,
  type Settings,
  springEasing,
  springPoints,
  tokensFor,
} from "../src/domain/index.ts";

const withMotion = (motion: Settings["motion"]): Settings => ({ ...DEFAULT_SETTINGS, motion });
const defaultsOn = EFFECT_IDS.filter((id) => EFFECTS[id].default);

test("system follows the OS: full without the preference, reduced with it", () => {
  assert.equal(resolveMotion(withMotion("system"), false).level, "full");
  assert.equal(resolveMotion(withMotion("system"), true).level, "reduced");
  assert.equal(resolveMotion(withMotion("system"), true).source, "system");
});

test("a forced mode ignores the OS", () => {
  assert.equal(resolveMotion(withMotion("full"), true).level, "full");
  assert.equal(resolveMotion(withMotion("full"), true).source, "user");
  assert.equal(resolveMotion(withMotion("reduced"), false).level, "reduced");
});

test("full runs every effect switched on, but never calmHost (it only calms under reduced)", () => {
  const all: Settings = {
    ...DEFAULT_SETTINGS,
    motion: "full",
    effects: Object.fromEntries(EFFECT_IDS.map((id) => [id, true])) as Settings["effects"],
  };
  assert.deepEqual(resolveMotion(all, false).effects, EFFECT_IDS.filter((id) => id !== "calmHost"));
  assert.deepEqual(resolveMotion(withMotion("full"), false).effects, defaultsOn);
});

test("reduced keeps only the effects that are safe without travel", () => {
  const { effects } = resolveMotion(withMotion("reduced"), false);
  for (const id of effects) assert.ok(EFFECTS[id].reducedSafe, id);
  assert.ok(!effects.includes("press") && !effects.includes("hoverLift") && !effects.includes("toastSpring"));
  assert.ok(effects.includes("listEnter") && effects.includes("focusRing"));
});

test("off runs nothing", () => {
  assert.deepEqual(resolveMotion(withMotion("off"), false).effects, []);
  assert.equal(resolveMotion(withMotion("off"), false).level, "off");
});

test("a switched-off effect stays off at every level", () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, effects: { ...DEFAULT_SETTINGS.effects, listEnter: false } };
  assert.ok(!resolveMotion(settings, false).effects.includes("listEnter"));
  assert.ok(!resolveMotion(settings, true).effects.includes("listEnter"));
});

test("decodeSettings: nothing stored is the defaults, with no problems", () => {
  const { settings, problems } = decodeSettings({});
  assert.deepEqual({ settings, problems }, { settings: DEFAULT_SETTINGS, problems: [] });
});

test("decodeSettings: a bad value falls back to its default and is reported", () => {
  const { settings, problems } = decodeSettings({ motion: "wild", speed: "relaxed", effects: { press: "yes", sendPulse: false } });
  assert.equal(settings.motion, "system");
  assert.equal(settings.speed, "relaxed");
  assert.equal(settings.effects.press, true);
  assert.equal(settings.effects.sendPulse, false);
  assert.deepEqual(
    problems.map((problem) => problem.field),
    ["effects.press", "motion"],
  );
});

test("effectAttribute: kebab-case under data-lively-", () => {
  assert.equal(effectAttribute("hoverLift"), "data-lively-hover-lift");
  assert.equal(effectAttribute("press"), "data-lively-press");
});

test("defaults: motion follows the system; the experimental-feeling ones start off", () => {
  assert.equal(DEFAULT_SETTINGS.motion, "system");
  assert.equal(DEFAULT_SETTINGS.speed, "normal");
  assert.equal(DEFAULT_SETTINGS.intensity, "bold");
  assert.deepEqual([DEFAULT_SETTINGS.style, DEFAULT_SETTINGS.skew, DEFAULT_SETTINGS.stickers, DEFAULT_SETTINGS.jelly], ["clean", true, "wobbly", "shared"]);
  assert.equal(DEFAULT_SETTINGS.effects.pageWipe, false);
  assert.equal(DEFAULT_SETTINGS.effects.typingGlow, false);
  assert.equal(DEFAULT_SETTINGS.effects.calmHost, false);
});

test("intensity: the one volume knob scales every token the same way", () => {
  const [subtle, lively, bold] = INTENSITIES.map((intensity) => MOTION_TOKENS.clean[intensity]);
  assert.ok(subtle && lively && bold);
  for (const key of ["enterMs", "overlayMs", "pulseMs", "overshoot", "rise", "lift", "liftShadow", "blur", "stagger", "rippleScale", "ringScale", "burst", "glow"] as const) {
    assert.ok(subtle[key] <= lively[key] && lively[key] <= bold[key], key);
  }
  for (const key of ["pressScale", "overlayScale"] as const) assert.ok(subtle[key] >= lively[key] && lively[key] >= bold[key], key);
});

test("intensity scales the wobbly style the same way: more bounce, squash, skew, tilt, sticker, swell, flash, chroma", () => {
  const [subtle, lively, bold] = INTENSITIES.map((intensity) => MOTION_TOKENS.wobbly[intensity]);
  assert.ok(subtle && lively && bold);
  for (const key of ["enterMs", "overlayMs", "overshoot", "rise", "squash", "sticker", "swell", "flash", "chroma"] as const) {
    assert.ok(subtle[key] < lively[key] && lively[key] < bold[key], key);
  }
  // Skew and tilt lean left: larger in magnitude, so more negative. The attack quickens.
  for (const key of ["skew", "tilt", "peakAt", "pressScale", "overlayScale"] as const) assert.ok(subtle[key] > lively[key] && lively[key] > bold[key], key);
});

test("subtle is v1: the same numbers lively shipped first", () => {
  const subtle = MOTION_TOKENS.clean.subtle;
  assert.deepEqual([subtle.pressMs, subtle.releaseMs, subtle.enterMs, subtle.rise, subtle.pressScale, subtle.blur, subtle.burst], [90, 160, 220, 6, 0.97, 0, 0]);
});

test("the easing family: each spring peaks at its overshoot and comes to rest at 1", () => {
  for (const intensity of INTENSITIES) {
    const tokens = MOTION_TOKENS.clean[intensity];
    const { overshoot } = tokens;
    const points = springPoints(tokens, 200);
    assert.equal(points[0], 0);
    assert.equal(points.at(-1), 1);
    assert.ok(Math.abs(Math.max(...points) - 1 - overshoot) < 0.01, `${intensity}: ${Math.max(...points)}`);
  }
  const easeOut = springPoints({ overshoot: 0 }, 200);
  assert.ok(Math.max(...easeOut) <= 1, "overshoot 0 is the plain ease-out");
  assert.match(springEasing({ overshoot: 0.16 }), /^linear\(0, .*, 1\)$/u);
});

test("reduced collapses every intensity to fades; the policy carries the intensity", () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, intensity: "bold", motion: "reduced" };
  const tokens = tokensFor(resolveMotion(settings, false));
  assert.equal(tokens, REDUCED_TOKENS);
  assert.deepEqual([tokens.rise, tokens.blur, tokens.burst, tokens.overshoot, tokens.breatheMs, tokens.pressScale], [0, 0, 0, 0, 0, 1]);
  const full = resolveMotion({ ...settings, motion: "full", speed: "snappy" }, false);
  assert.equal(full.intensity, "bold");
  assert.equal(full.style, "clean");
  assert.equal(tokensFor(full).enterMs, MOTION_TOKENS.clean.bold.enterMs * 0.8);
});

/** Local maxima above 1: the visible overshoots of a spring. */
const swings = (points: ReadonlyArray<number>) =>
  points.filter((point, index) => index > 0 && point > 1.001 && point >= (points[index - 1] ?? 0) && point >= (points[index + 1] ?? Infinity)).length;

test("the style axis: clean has no style tokens and swings once; wobbly attacks sooner and swings two or three times", () => {
  for (const intensity of INTENSITIES) {
    const clean = MOTION_TOKENS.clean[intensity];
    assert.deepEqual([clean.peakAt, clean.squash, clean.skew, clean.tilt, clean.swell, clean.flash, clean.chroma], [0.4, 0, 0, 0, 0, 0, 0]);
    assert.equal(swings(springPoints(clean, 400)), 1, intensity);
    const wobbly = MOTION_TOKENS.wobbly[intensity];
    const points = springPoints(wobbly, 400);
    assert.equal(points.at(-1), 1);
    assert.ok(Math.abs(Math.max(...points) - 1 - wobbly.overshoot) < 0.01, `${intensity}: ${Math.max(...points)}`);
    assert.ok(landsAt(wobbly) < landsAt(clean), intensity);
    assert.equal(wobbly.blur, 0, "ZZZ edges are hard: no blur-in");
  }
  assert.ok(swings(springPoints(MOTION_TOKENS.wobbly.subtle, 400)) >= 1);
  assert.ok(swings(springPoints(MOTION_TOKENS.wobbly.lively, 400)) >= 2);
  assert.ok(swings(springPoints(MOTION_TOKENS.wobbly.bold, 400)) >= 3);
  // Clean's curve is what it was before styles existed: 24 points, one overshoot.
  assert.equal(springPoints(MOTION_TOKENS.clean.bold).length, 25);
});

test("jelly: the swings of the matching spring, each -overshoot times the last", () => {
  assert.deepEqual(jellyCoefficients(0.3), [1, -0.3, 0.09, -0.027]);
});

test("the policy resolves skew, stickers and jelly from the style", () => {
  const wobbly: Settings = { ...DEFAULT_SETTINGS, motion: "full", style: "wobbly" };
  const full = resolveMotion(wobbly, false);
  assert.deepEqual([full.style, full.skew, full.stickers, full.jelly], ["wobbly", true, true, "shared"]);
  assert.equal(tokensFor(full).squash, MOTION_TOKENS.wobbly.bold.squash);
  assert.equal(resolveMotion({ ...wobbly, skew: false }, false).skew, false);
  // Under reduced, no skew; stickers stay (paint, not motion); every style token is 0.
  const reduced = resolveMotion({ ...wobbly, motion: "reduced" }, false);
  assert.deepEqual([reduced.skew, reduced.stickers], [false, true]);
  const calm = tokensFor(reduced);
  assert.deepEqual([calm.squash, calm.skew, calm.tilt, calm.swell, calm.flash, calm.chroma, calm.overshoot], [0, 0, 0, 0, 0, 0, 0]);
  // Stickers: with wobbly by default, always on request, never when off; never with motion off.
  const clean = { ...DEFAULT_SETTINGS, motion: "full" } as const;
  assert.equal(resolveMotion(clean, false).stickers, false);
  assert.equal(resolveMotion({ ...clean, stickers: "always" }, false).stickers, true);
  assert.equal(resolveMotion({ ...wobbly, stickers: "off" }, false).stickers, false);
  assert.equal(resolveMotion({ ...wobbly, motion: "off" }, false).stickers, false);
  // Clean never skews, whatever the switch says.
  assert.equal(resolveMotion({ ...clean, skew: true }, false).skew, false);
});

test("the style settings decode, and bad values fall back with a problem", () => {
  const { settings, problems } = decodeSettings({ style: "wobbly", skew: false, stickers: "always", jelly: "matched" });
  assert.deepEqual([settings.style, settings.skew, settings.stickers, settings.jelly], ["wobbly", false, "always", "matched"]);
  assert.deepEqual(problems, []);
  const bad = decodeSettings({ style: "jelly", skew: "yes", stickers: 3, jelly: "wobbly" });
  assert.deepEqual([bad.settings.style, bad.settings.skew, bad.settings.stickers, bad.settings.jelly], ["clean", true, "wobbly", "shared"]);
  assert.deepEqual(bad.problems.map((problem) => problem.field), ["style", "skew", "stickers", "jelly"]);
});
