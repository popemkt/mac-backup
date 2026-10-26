// The bb adapter: settings as bb validates them, status pulses from sidebar
// indicator changes, and standing still while bbim shows hints.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { registerSettingDescriptors } from "@get-bb/plugin-sdk/internal/host-policy";
import { Window } from "happy-dom";
import { DEFAULT_SETTINGS, EFFECT_IDS, PRESETS } from "@popemkt/bb-lively-core/domain";
import { mountLively, selectorHealth, sent, syncSettings, threadsChanged, toneFor } from "../adapter/bb.ts";
import { BBIM_ACTIVE } from "../adapter/selectors.ts";
import { artImageUrl, effectiveRows, effectiveSettings, SETTINGS, settingsInput } from "../adapter/settings.ts";

const FIXTURE = readFileSync(new URL("fixtures/bb-0.46.1.html", import.meta.url), "utf8");

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const step of cleanup) step();
  cleanup = [];
  syncSettings({});
});

function bb(): { win: globalThis.Window & typeof globalThis; doc: Document } {
  const happy = new Window({ url: "https://bb.test/" });
  const win = happy as unknown as globalThis.Window & typeof globalThis;
  win.document.body.innerHTML = FIXTURE;
  const controller = new AbortController();
  mountLively(controller.signal, win);
  cleanup.push(() => {
    controller.abort();
    void happy.happyDOM.close();
  });
  return { win, doc: win.document };
}

const threadId = (doc: Document) => doc.querySelector("[data-sidebar-thread-id]")?.getAttribute("data-sidebar-thread-id") ?? "";
const card = (doc: Document) => doc.querySelector("[data-parent-card]");

test("settings: bb's own validator accepts the table; every default passes its own schema", async () => {
  const registered = registerSettingDescriptors({}, SETTINGS);
  assert.deepEqual(Object.keys(registered).toSorted(), Object.keys(SETTINGS).toSorted());
  for (const id of EFFECT_IDS) assert.ok(id in SETTINGS, id);
  const results = await Promise.all(
    Object.entries(SETTINGS).map(async ([id, descriptor]) => {
      const schema = descriptor.experimental_schema;
      assert.ok(schema, `${id} has a schema`);
      // A select's schema takes strings and a boolean's booleans; each default is its own type.
      const validate = schema["~standard"].validate as (value: unknown) => unknown;
      return { id, result: (await validate(descriptor.default)) as { issues?: unknown } };
    }),
  );
  for (const { id, result } of results) assert.equal("issues" in result ? result.issues : undefined, undefined, id);
});

/** bb's values when nothing is stored: every descriptor's default. */
const DEFAULTS = Object.fromEntries(Object.entries(SETTINGS).map(([key, descriptor]) => [key, descriptor.default]));

test("settings: stored values come back as core input; nothing stored is the base defaults", () => {
  assert.equal(settingsInput({ motion: "reduced", press: "off" }).effects?.["press"], false);
  assert.equal(settingsInput({ press: "on" }).effects?.["press"], true);
  assert.equal(settingsInput({}).motion, undefined);
  assert.deepEqual(effectiveSettings(DEFAULTS).settings, DEFAULT_SETTINGS);
  assert.deepEqual(effectiveSettings(DEFAULTS).problems, []);
  // Every presettable setting starts on From preset; the preset on custom.
  for (const [key, descriptor] of Object.entries(SETTINGS)) {
    if (key !== "preset" && key !== "artImage") assert.equal(descriptor.default, "preset", key);
  }
});

test("settings: picking a preset moves what is still From preset; a tweak stays", () => {
  const zzz = effectiveSettings({ ...DEFAULTS, preset: "zzz" });
  assert.deepEqual([zzz.settings.style, zzz.settings.jelly, zzz.settings.effects.pageWipe], ["wobbly", "matched", true]);
  const tweaked = effectiveSettings({ ...DEFAULTS, preset: "zzz", style: "clean", pageWipe: "off" });
  assert.deepEqual([tweaked.settings.style, tweaked.settings.effects.pageWipe, tweaked.settings.jelly], ["clean", false, "matched"]);
  const rows = new Map(effectiveRows(tweaked).map((row) => [row.key, row]));
  assert.deepEqual([rows.get("style")?.value, rows.get("style")?.source], ["Clean", "you set"]);
  assert.deepEqual([rows.get("jelly")?.value, rows.get("jelly")?.source], ["Matched", "from ZZZ"]);
  assert.deepEqual([rows.get("motion")?.value, rows.get("motion")?.source], ["System", "default"]);
  assert.deepEqual([rows.get("palette")?.value, rows.get("palette")?.source], ["lively-zzz", "from ZZZ"]);
  assert.equal(rows.size, 9 + EFFECT_IDS.length);
});

test("settings: an art image path is served by lively's route; a URL is used as is", () => {
  assert.equal(artImageUrl("https://example.com/a.png"), "https://example.com/a.png");
  assert.equal(artImageUrl("~/art/my file.png"), "/api/v1/plugins/bb-lively/http/art?v=~%2Fart%2Fmy%20file.png");
  assert.equal(artImageUrl(""), "");
  assert.equal(effectiveSettings({ ...DEFAULTS, artImage: '/x/"a.png' }).settings.artImage, "/api/v1/plugins/bb-lively/http/art?v=%2Fx%2F%22a.png");
});

test("manifest: every preset's palette is one of lively's bb themes", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { bb: { themes: ReadonlyArray<{ id: string; css: string }> } };
  const themes = new Set(manifest.bb.themes.map((theme) => theme.id));
  for (const preset of PRESETS) if ("palette" in preset) assert.ok(themes.has(preset.palette), `${preset.id}: ${preset.palette}`);
});

test("toneFor: finished, failed and waiting pulse; a first sighting or no change never does", () => {
  assert.equal(toneFor("runtime", "unread-success"), "success");
  assert.equal(toneFor("runtime", "unread-error"), "error");
  assert.equal(toneFor("runtime", "waiting-for-input"), "waiting");
  assert.equal(toneFor(undefined, "unread-success"), undefined);
  assert.equal(toneFor("unread-success", "unread-success"), undefined);
  assert.equal(toneFor("none", "runtime"), undefined);
});

test("threadsChanged: a thread finishing rings its sidebar card in the success tone", () => {
  const { doc } = bb();
  const id = threadId(doc);
  const seen = threadsChanged(new Map(), [{ id, indicator: "runtime" }]);
  assert.equal(card(doc)?.classList.contains("lively-pulse"), false, "first sighting: no ring");
  threadsChanged(seen, [{ id, indicator: "unread-success" }]);
  assert.equal(card(doc)?.getAttribute("data-lively-tone"), "success");
});

test("bbim: while data-bbim-active is on <html>, nothing new starts", () => {
  const { doc } = bb();
  doc.documentElement.setAttribute(BBIM_ACTIVE, "");
  const id = threadId(doc);
  threadsChanged(new Map([[id, "runtime"]]), [{ id, indicator: "unread-error" }]);
  sent();
  assert.equal(doc.querySelectorAll(".lively-pulse, .lively-send").length, 0);
  doc.documentElement.removeAttribute(BBIM_ACTIVE);
  sent();
  assert.equal(doc.querySelectorAll(".lively-send").length, 1, "the send button ripples once bbim is done");
});

test("selector health: the canary reports what matched in this window", () => {
  bb();
  const readings = selectorHealth() ?? [];
  const byId = new Map(readings.map((reading) => [reading.entry.id, reading]));
  assert.equal(byId.get("sendButton")?.seen, true);
  assert.equal(byId.get("toast")?.seen, false, "no toast on screen in the capture");
});
