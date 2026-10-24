// The pure domain: settings decoding and the motion policy.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SETTINGS,
  decodeSettings,
  EFFECT_IDS,
  EFFECTS,
  effectAttribute,
  resolveMotion,
  type Settings,
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
  assert.equal(DEFAULT_SETTINGS.effects.typingGlow, false);
  assert.equal(DEFAULT_SETTINGS.effects.calmHost, false);
});
