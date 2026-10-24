// The bb adapter: settings as bb validates them, status pulses from sidebar
// indicator changes, and standing still while bbim shows hints.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { registerSettingDescriptors } from "@get-bb/plugin-sdk/internal/host-policy";
import { Window } from "happy-dom";
import { DEFAULT_SETTINGS, EFFECT_IDS } from "@popemkt/bb-lively-core/domain";
import { mountLively, selectorHealth, sent, syncSettings, threadsChanged, toneFor } from "../adapter/bb.ts";
import { BBIM_ACTIVE } from "../adapter/selectors.ts";
import { SETTINGS, settingsInput } from "../adapter/settings.ts";

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

test("settings: stored values come back as core input; nothing stored is the defaults", () => {
  assert.deepEqual(settingsInput({ motion: "reduced", press: false }).effects?.["press"], false);
  assert.equal(settingsInput({}).motion, undefined);
  assert.equal(DEFAULT_SETTINGS.motion, SETTINGS.motion.default);
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
