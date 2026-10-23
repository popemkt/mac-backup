// Settings, the bridge protocol, target rules and modes, over plain data. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { current, INITIAL_STACK, leave, ownsKeyboard, push } from "../src/domain/modes.ts";
import { BRIDGE_PROTOCOL, decodeFrameMessage, decodeParentMessage, isOpenableUrl } from "../src/domain/protocol.ts";
import { decodeSettings, DEFAULT_SETTINGS, keyBindings } from "../src/domain/settings.ts";
import { type Candidate, classify, dedupe, order, type Rect, TARGET_KINDS } from "../src/domain/targets.ts";

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

const keyMessage = {
  bbim: BRIDGE_PROTOCOL,
  type: "key",
  key: "a",
  code: "KeyA",
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
};

test("protocol: well-formed messages decode", () => {
  assert.deepEqual(decodeFrameMessage(targets), targets);
  assert.ok(decodeParentMessage({ bbim: BRIDGE_PROTOCOL, type: "collect", requestId: "x" }) !== undefined);
  assert.ok(
    decodeParentMessage({ bbim: BRIDGE_PROTOCOL, type: "activate", requestId: "x", targetId: 3, newTab: true }) !== undefined,
  );
  assert.ok(decodeParentMessage({ bbim: BRIDGE_PROTOCOL, type: "mode", active: false }) !== undefined);
  assert.ok(decodeFrameMessage(keyMessage) !== undefined);
  assert.ok(decodeFrameMessage({ bbim: BRIDGE_PROTOCOL, type: "open", requestId: "x", url: "https://a.test/" }) !== undefined);
  assert.ok(decodeFrameMessage({ bbim: BRIDGE_PROTOCOL, type: "leave", reason: "lapsed" }) !== undefined);
  assert.equal(decodeFrameMessage({ bbim: BRIDGE_PROTOCOL, type: "leave", reason: "bored" }), undefined);
});

test("protocol: untrusted frame data is refused, not repaired", () => {
  const { repeat: _repeat, ...withoutRepeat } = keyMessage;
  const bad: ReadonlyArray<unknown> = [
    null,
    "targets",
    [targets],
    { ...targets, bbim: "bbim-bridge/0" },
    { ...targets, type: "collect" },
    { ...targets, type: "constructor" },
    { ...targets, type: "__proto__" },
    { ...targets, extra: 1 },
    { ...targets, targets: [{ id: 0, kind: "link", left: Number.NaN, top: 0, width: 1, height: 1 }] },
    { ...targets, targets: [{ id: 0, kind: "link", left: Number.POSITIVE_INFINITY, top: 0, width: 1, height: 1 }] },
    { ...targets, targets: [{ id: 0, kind: "script", left: 0, top: 0, width: 1, height: 1 }] },
    { ...targets, targets: [{ id: -1, kind: "link", left: 0, top: 0, width: 1, height: 1 }] },
    { ...targets, targets: [{ id: 0.5, kind: "link", left: 0, top: 0, width: 1, height: 1 }] },
    { ...targets, targets: [{ id: 0, kind: "link", left: 0, top: 0, width: -5, height: 1 }] },
    { ...targets, targets: [{ id: 0, kind: "link", left: 0, top: 0, width: 1, height: 1, onclick: "x" }] },
    { ...targets, targets: Array.from({ length: 2001 }, (_, id) => ({ id, kind: "link", left: 0, top: 0, width: 1, height: 1 })) },
    { ...targets, targets: { length: 0 } },
    { ...targets, requestId: "x".repeat(65) },
    withoutRepeat,
    { ...keyMessage, key: "k".repeat(65) },
    { ...keyMessage, ctrlKey: "true" },
    { bbim: BRIDGE_PROTOCOL, type: "open", url: 42 },
  ];
  for (const message of bad) assert.equal(decodeFrameMessage(message), undefined, `${JSON.stringify(message) as string | undefined}`.slice(0, 80));
  assert.equal(decodeParentMessage({ bbim: BRIDGE_PROTOCOL, type: "activate", requestId: "x", targetId: 1.5, newTab: true }), undefined);
  assert.equal(decodeParentMessage(targets), undefined, "a frame message is not a parent message");
});

const requestIdArb = fc.string({ maxLength: 64 });
const frameMessageArb = fc.oneof(
  fc.record({
    bbim: fc.constant(BRIDGE_PROTOCOL),
    type: fc.constant("targets"),
    requestId: requestIdArb,
    targets: fc.array(
      fc.record({
        id: fc.nat(),
        kind: fc.constantFrom(...TARGET_KINDS),
        left: fc.double({ min: -100_000, max: 100_000, noNaN: true }),
        top: fc.double({ min: -100_000, max: 100_000, noNaN: true }),
        width: fc.double({ min: 0, max: 100_000, noNaN: true }),
        height: fc.double({ min: 0, max: 100_000, noNaN: true }),
      }),
      { maxLength: 20 },
    ),
  }),
  fc.record({
    bbim: fc.constant(BRIDGE_PROTOCOL),
    type: fc.constant("key"),
    key: fc.string({ maxLength: 64 }),
    code: fc.string({ maxLength: 64 }),
    ctrlKey: fc.boolean(),
    altKey: fc.boolean(),
    metaKey: fc.boolean(),
    shiftKey: fc.boolean(),
    repeat: fc.boolean(),
    isComposing: fc.boolean(),
  }),
  fc.record({ bbim: fc.constant(BRIDGE_PROTOCOL), type: fc.constant("open"), requestId: requestIdArb, url: fc.webUrl() }),
  fc.record({ bbim: fc.constant(BRIDGE_PROTOCOL), type: fc.constant("leave"), reason: fc.constantFrom("pointer", "lapsed") }),
);
const parentMessageArb = fc.oneof(
  fc.record({ bbim: fc.constant(BRIDGE_PROTOCOL), type: fc.constant("collect"), requestId: requestIdArb }),
  fc.record({
    bbim: fc.constant(BRIDGE_PROTOCOL),
    type: fc.constant("activate"),
    requestId: requestIdArb,
    targetId: fc.nat(),
    newTab: fc.boolean(),
  }),
  fc.record({ bbim: fc.constant(BRIDGE_PROTOCOL), type: fc.constant("mode"), active: fc.boolean() }),
);

test("protocol (property): valid messages survive postMessage's structured clone and decode unchanged", () => {
  fc.assert(
    fc.property(frameMessageArb, (message) => {
      const copy: unknown = structuredClone(message);
      assert.equal(JSON.stringify(decodeFrameMessage(copy)), JSON.stringify(message));
    }),
  );
  fc.assert(
    fc.property(parentMessageArb, (message) => {
      const copy: unknown = structuredClone(message);
      assert.equal(JSON.stringify(decodeParentMessage(copy)), JSON.stringify(message));
    }),
  );
});

test("protocol (property): random junk never decodes", () => {
  fc.assert(
    fc.property(fc.anything({ withNullPrototype: true, withObjectString: true }), (junk) => {
      assert.equal(decodeFrameMessage(junk), undefined);
      assert.equal(decodeParentMessage(junk), undefined);
    }),
  );
  // Junk wearing the marker and a real type: still refused field by field.
  fc.assert(
    fc.property(
      fc.constantFrom("targets", "key", "open", "leave", "collect", "activate", "mode"),
      fc.dictionary(fc.string(), fc.anything()),
      (type, fields) => {
        const data = { ...fields, bbim: BRIDGE_PROTOCOL, type };
        fc.pre(Object.keys(fields).length > 0);
        assert.equal(decodeFrameMessage(data), undefined);
        assert.equal(decodeParentMessage(data), undefined);
      },
    ),
  );
});

test("protocol (property): a valid message with a field dropped, retyped or added is refused", () => {
  fc.assert(
    fc.property(frameMessageArb, fc.nat(), fc.constantFrom("drop", "retype", "add"), (message, pick, how) => {
      const keys = Object.keys(message).filter((key) => key !== "bbim" && key !== "type");
      const key = keys[pick % keys.length] ?? "extra";
      const changed: Record<string, unknown> = { ...message };
      if (how === "drop") delete changed[key];
      else if (how === "retype") changed[key] = { not: "this" };
      else changed["extra"] = 1;
      assert.equal(decodeFrameMessage(changed), undefined);
    }),
  );
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
