// The bb adapter's settings table: what bb is told, and how bb's stored
// values come back into the core.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Result, Schema } from "effect";
import { ACTIONS, DEFAULT_SETTINGS, decodeSettings } from "@popemkt/bbim-core/domain";
import { registerSettingDescriptors } from "@get-bb/plugin-sdk/internal/host-policy";
import { BbKeySequence, keySettingId, SETTINGS, settingsInput } from "../adapter/settings.ts";

const accepts = (value: unknown) => Result.isSuccess(Schema.decodeUnknownResult(BbKeySequence)(value));

test("every action has a key setting, and every default passes its own schema", async () => {
  for (const action of ACTIONS) assert.ok(keySettingId(action) in SETTINGS, action);
  const results = await Promise.all(
    Object.entries(SETTINGS).map(async ([id, descriptor]) => ({
      id,
      result: await descriptor.experimental_schema["~standard"].validate(descriptor.default),
    })),
  );
  for (const { id, result } of results) assert.equal("issues" in result ? result.issues : undefined, undefined, id);
});

test("bb's own validator accepts the settings table (ids, descriptor shape, schemas)", () => {
  // The check bb runs when the plugin calls bb.settings.define; a failure here
  // is "bbim is not running: invalid descriptor for setting ..." in the app.
  const registered = registerSettingDescriptors({}, SETTINGS);
  assert.deepEqual(Object.keys(registered).toSorted(), Object.keys(SETTINGS).toSorted());
});

test("key settings: vim notation, but never a leading digit (bb's question answers)", () => {
  assert.ok(accepts("gg"));
  assert.ok(accepts("<A-1>"));
  assert.ok(accepts(""));
  assert.equal(accepts("1"), false);
  assert.equal(accepts("2j"), false);
  assert.equal(accepts("<Esc>"), false);
});

test("settingsInput: stored values decode, a digit-led key falls back to its default", () => {
  const { settings, problems } = decodeSettings(
    settingsInput({ bareKeys: false, scrollStep: 120, [keySettingId("scrollDown")]: "1", [keySettingId("scrollUp")]: "e" }),
    DEFAULT_SETTINGS,
  );
  assert.equal(settings.bareKeys, false);
  assert.equal(settings.scrollStep, 120);
  assert.equal(settings.keys.scrollDown, DEFAULT_SETTINGS.keys.scrollDown);
  assert.equal(settings.keys.scrollUp, "e");
  assert.ok(problems.length > 0);
});

test("settingsInput: nothing stored is the defaults, with no problems", () => {
  const { settings, problems } = decodeSettings(settingsInput({}), DEFAULT_SETTINGS);
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.deepEqual(problems, []);
});
