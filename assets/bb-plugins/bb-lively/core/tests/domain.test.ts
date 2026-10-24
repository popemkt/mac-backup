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
  landsAt,
  MOTION_TOKENS,
  MAX_ONCE_MS,
  MAX_PRESS_MS,
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
  assert.deepEqual(decodeSettings({}), { settings: DEFAULT_SETTINGS, problems: [] });
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

test("intensity: presses stay snappy; nothing that runs once outlasts an entrance", () => {
  for (const intensity of INTENSITIES) {
    const tokens = MOTION_TOKENS.clean[intensity];
    assert.ok(tokens.pressMs <= MAX_PRESS_MS, intensity);
    for (const ms of [tokens.releaseMs, tokens.enterMs, tokens.overlayMs, tokens.exitMs, tokens.pulseMs]) assert.ok(ms <= MAX_ONCE_MS, `${intensity} ${ms}`);
  }
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

test("the style axis: clean bounces once and lands at its peak; more bounces land sooner and still rest at 1", () => {
  for (const intensity of INTENSITIES) {
    const tokens = MOTION_TOKENS.clean[intensity];
    assert.equal(tokens.bounces, 1);
    assert.ok(landsAt(tokens) <= 0.4, `${intensity}: ${landsAt(tokens)}`);
  }
  const wobbly = { overshoot: 0.16, bounces: 3 };
  assert.ok(landsAt(wobbly) < landsAt({ overshoot: 0.16 }));
  assert.equal(springPoints(wobbly).at(-1), 1);
  assert.ok(Math.abs(Math.max(...springPoints(wobbly, 400)) - 1.16) < 0.01);
});
