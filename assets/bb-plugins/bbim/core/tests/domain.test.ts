// Settings, the bridge protocol, target rules and modes, over plain data. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { Option } from "effect";
import { current, INITIAL_STACK, leave, ownsKeyboard, push } from "../src/domain/modes.ts";
import { BRIDGE_PROTOCOL, decodeFrameMessage, decodeParentMessage, isOpenableUrl } from "../src/domain/protocol.ts";
import { decodeSettings, DEFAULT_SETTINGS, keyBindings } from "../src/domain/settings.ts";
import { type Candidate, classify, dedupe, order, type Rect } from "../src/domain/targets.ts";

test("settings: defaults when nothing is given", () => {
  const { settings, problems } = decodeSettings({});
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.deepEqual(problems, []);
  assert.equal(keyBindings(settings).length, 10);
});

test("settings: a bad field falls back alone and is reported", () => {
  const { settings, problems } = decodeSettings({
    bareKeys: false,
    hintAlphabet: "AsDf",
    scrollStep: -4,
    keys: { scrollDown: "<Esc>", scrollUp: "<nope>", hints: "<A-h>", help: "" },
  });
  assert.equal(settings.bareKeys, false);
  assert.equal(settings.hintAlphabet, "AsDf");
  assert.equal(settings.scrollStep, DEFAULT_SETTINGS.scrollStep);
  assert.equal(settings.keys.scrollDown, "j");
  assert.equal(settings.keys.scrollUp, "k");
  assert.equal(settings.keys.hints, "<A-h>");
  assert.equal(settings.keys.help, "", "empty unbinds");
  assert.deepEqual(
    problems.map((problem) => problem.field),
    ["keys.scrollDown", "keys.scrollUp", "scrollStep"],
  );
  assert.ok(!keyBindings(settings).some((binding) => binding.action === "help"));
});

test("settings: decoding never throws, whatever arrives", () => {
  fc.assert(
    fc.property(fc.anything(), fc.anything(), fc.dictionary(fc.string(), fc.anything()), (alphabet, step, keys) => {
      decodeSettings({ hintAlphabet: alphabet, scrollStep: step, keys });
    }),
  );
});

const targets = {
  bbim: BRIDGE_PROTOCOL,
  type: "targets",
  requestId: "r1",
  targets: [{ id: 0, kind: "link", left: 10, top: 20, width: 30, height: 12 }],
};

test("protocol: well-formed messages decode", () => {
  assert.ok(Option.isSome(decodeFrameMessage(targets)));
  assert.ok(Option.isSome(decodeParentMessage({ bbim: BRIDGE_PROTOCOL, type: "collect", requestId: "x" })));
  assert.ok(
    Option.isSome(decodeParentMessage({ bbim: BRIDGE_PROTOCOL, type: "activate", requestId: "x", targetId: 3, newTab: true })),
  );
  assert.ok(
    Option.isSome(
      decodeFrameMessage({
        bbim: BRIDGE_PROTOCOL,
        type: "key",
        key: "a",
        code: "KeyA",
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ),
  );
});

test("protocol: untrusted frame data is refused, not repaired", () => {
  const bad: ReadonlyArray<unknown> = [
    null,
    "targets",
    { ...targets, bbim: "bbim-bridge/0" },
    { ...targets, type: "collect" },
    { ...targets, targets: [{ id: 0, kind: "link", left: Number.NaN, top: 0, width: 1, height: 1 }] },
    { ...targets, targets: [{ id: 0, kind: "script", left: 0, top: 0, width: 1, height: 1 }] },
    { ...targets, targets: [{ id: -1, kind: "link", left: 0, top: 0, width: 1, height: 1 }] },
    { ...targets, targets: [{ id: 0, kind: "link", left: 0, top: 0, width: -5, height: 1 }] },
    { ...targets, targets: Array.from({ length: 2001 }, (_, id) => ({ id, kind: "link", left: 0, top: 0, width: 1, height: 1 })) },
    { ...targets, requestId: "x".repeat(65) },
    { bbim: BRIDGE_PROTOCOL, type: "open", url: 42 },
  ];
  for (const message of bad) assert.ok(Option.isNone(decodeFrameMessage(message)), JSON.stringify(message).slice(0, 80));
  assert.ok(Option.isNone(decodeParentMessage({ bbim: BRIDGE_PROTOCOL, type: "activate", requestId: "x", targetId: 1.5, newTab: true })));
});

test("protocol: only http(s) URLs are openable", () => {
  assert.ok(isOpenableUrl("https://example.com/a"));
  assert.ok(isOpenableUrl("http://localhost:3000"));
  for (const url of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "/relative", ""]) {
    assert.ok(!isOpenableUrl(url), url);
  }
});

test("targets: classification by tag, type and role", () => {
  const facts = (tag: string, extra: Partial<Parameters<typeof classify>[0]> = {}) => ({
    tag,
    type: null,
    role: null,
    hasHref: false,
    contentEditable: false,
    ...extra,
  });
  assert.equal(classify(facts("A", { hasHref: true })), "link");
  assert.equal(classify(facts("input", { type: "email" })), "text");
  assert.equal(classify(facts("input", { type: "checkbox" })), "toggle");
  assert.equal(classify(facts("input", { type: "submit" })), "button");
  assert.equal(classify(facts("input", { type: "hidden" })), undefined);
  assert.equal(classify(facts("div", { contentEditable: true })), "text");
  assert.equal(classify(facts("select")), "select");
  assert.equal(classify(facts("div", { role: "switch" })), "toggle");
  assert.equal(classify(facts("div", { role: "menuitem" })), "button");
  assert.equal(classify(facts("span", { role: "link" })), "link");
  assert.equal(classify(facts("div")), "weak");
});

const viewport: Rect = { left: 0, top: 0, width: 1000, height: 800 };
const box = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height });

test("targets: nested duplicates collapse to the stronger, distinct nested actions stay", () => {
  const candidates: ReadonlyArray<Candidate> = [
    { kind: "link", rect: box(0, 0, 300, 40) }, // 0: a thread row link
    { kind: "button", rect: box(260, 8, 24, 24) }, // 1: its menu button: a second action
    { kind: "weak", rect: box(0, 0, 300, 40) }, // 2: a tabindex wrapper the same size as the row
    { kind: "weak", rect: box(10, 10, 50, 20) }, // 3: a weak span inside the link
    { kind: "weak", rect: box(0, 0, 900, 700) }, // 4: a focusable scroll region
    { kind: "button", rect: box(400, 400, 80, 30) }, // 5: a lone button
  ];
  const parentOf: Record<number, number | undefined> = { 0: 2, 1: 0, 3: 0, 2: 4, 5: 4 };
  const ancestors = function* (inner: number) {
    for (let at = parentOf[inner]; at !== undefined; at = parentOf[at]) yield at;
  };
  assert.deepEqual(dedupe(candidates, ancestors, viewport), [0, 1, 5]);
});

test("targets: dedupe visits each candidate's ancestors once, not every pair", () => {
  // 3000 buttons in one weak wrapper: pairs would be 9 million steps.
  const count = 3000;
  const candidates: Array<Candidate> = [
    { kind: "weak", rect: box(0, 0, 100, 100) },
    ...Array.from({ length: count }, (_, index) => ({ kind: "button" as const, rect: box(index % 50, Math.floor(index / 50), 1, 1) })),
  ];
  let steps = 0;
  const ancestors = function* (inner: number) {
    if (inner === 0) return;
    steps += 1;
    yield 0;
  };
  const kept = dedupe(candidates, ancestors, viewport);
  assert.equal(kept.length, count, "the wrapper defers to its buttons");
  assert.ok(steps <= count, `${steps} ancestor steps`);
});

test("targets: order starts in the focus region, nearest its corner first", () => {
  const rects = [box(600, 500, 10, 10), box(10, 10, 10, 10), box(520, 120, 10, 10), box(700, 110, 10, 10)];
  const focus = box(500, 100, 400, 500);
  assert.deepEqual(order(rects, focus), [2, 3, 0, 1]);
  assert.deepEqual(order(rects, undefined), [1, 2, 3, 0]);
});

test("modes: a stack over normal; leaving a mode drops what is above it", () => {
  let stack = push(INITIAL_STACK, "hint");
  assert.equal(current(stack), "hint");
  assert.equal(push(stack, "hint"), stack);
  stack = push(stack, "help");
  stack = leave(stack, "hint");
  assert.equal(current(stack), "normal");
  assert.equal(leave(stack, "normal"), stack);
  assert.ok(ownsKeyboard("hint") && ownsKeyboard("help") && !ownsKeyboard("normal"));
});
