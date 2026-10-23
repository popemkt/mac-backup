// Key notation, events, and the matcher every binding goes through. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { Result } from "effect";
import {
  formatSequence,
  type KeyStroke,
  parseSequence,
  stroke,
  strokeFromEvent,
  strokeId,
} from "../src/domain/keys.ts";
import { back, compileKeymap, EMPTY_STATE, feed, type MatchState, reachable, typed } from "../src/domain/matcher.ts";

function parse(input: string): ReadonlyArray<KeyStroke> {
  const parsed = parseSequence(input);
  assert.ok(Result.isSuccess(parsed), `${input} should parse`);
  return parsed.success;
}

function event(key: string, extra: Partial<Parameters<typeof strokeFromEvent>[0]> = {}) {
  return { key, code: "", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...extra };
}

test("notation: characters, chords and named keys", () => {
  assert.deepEqual(parse("gg").map(strokeId), ["g", "g"]);
  assert.deepEqual(parse("G").map(strokeId), ["G"]);
  assert.deepEqual(parse("<A-f>").map(strokeId), ["<A-f>"]);
  assert.deepEqual(parse("<a-s-F>").map(strokeId), ["<A-F>"], "shift picks the letter's case and is folded into it");
  assert.deepEqual(parse("<C-->").map(strokeId), ["<C-->"]);
  assert.deepEqual(parse("<Esc><Space><lt>").map(strokeId), ["<Esc>", "<Space>", "<lt>"]);
  assert.deepEqual(parse("<").map(strokeId), ["<lt>"]);
  assert.deepEqual(parse(""), []);
});

test("notation: rejects what is not a key", () => {
  for (const bad of ["<X-f>", "<nope>", "a b", "<C->"]) assert.ok(Result.isFailure(parseSequence(bad)), bad);
});

const strokes = fc
  .record({
    key: fc.oneof(
      fc.constantFrom(..."abcdefgXYZ?!/<-.,;'[]0123456789"),
      fc.constantFrom("Escape", "Enter", "Tab", " ", "ArrowUp", "F5", "Backspace"),
    ),
    ctrl: fc.boolean(),
    alt: fc.boolean(),
    meta: fc.boolean(),
    shift: fc.boolean(),
  })
  .map(({ key, ...modifiers }) => stroke(key, modifiers));

test("notation: format then parse is the identity on strokes", () => {
  fc.assert(
    fc.property(fc.array(strokes, { maxLength: 6 }), (sequence) => {
      assert.deepEqual(parse(formatSequence(sequence)).map(strokeId), sequence.map(strokeId));
    }),
  );
});

test("events: option-letters on macOS are read from the physical key", () => {
  assert.equal(strokeId(strokeFromEvent(event("ƒ", { code: "KeyF", altKey: true })) ?? stroke("")), "<A-f>");
  assert.equal(strokeId(strokeFromEvent(event("Ï", { code: "KeyF", altKey: true, shiftKey: true })) ?? stroke("")), "<A-F>");
  assert.equal(strokeId(strokeFromEvent(event("Dead", { code: "KeyE", altKey: true })) ?? stroke("")), "<A-e>");
  assert.equal(strokeId(strokeFromEvent(event("?", { code: "Slash", shiftKey: true })) ?? stroke("")), "?");
  assert.equal(strokeId(strokeFromEvent(event("D", { code: "KeyD", ctrlKey: true, shiftKey: true })) ?? stroke("")), "<C-D>");
  assert.equal(strokeFromEvent(event("Shift", { shiftKey: true })), undefined);
});

const keymap = compileKeymap(
  [
    { sequence: parse("j"), action: "down" },
    { sequence: parse("gg"), action: "top" },
    { sequence: parse("gi"), action: "input" },
    { sequence: parse("<A-f>"), action: "hints" },
  ],
  { timeoutMs: 1000 },
);

function run(keys: string, start: MatchState = EMPTY_STATE, at = 0) {
  let state = start;
  const steps = [];
  for (const key of parse(keys)) {
    const [next, step] = feed(keymap, state, key, at);
    state = next;
    steps.push(step.kind === "match" ? step.binding.action : step.kind);
  }
  return { state, steps };
}

test("matcher: single keys, sequences and chords", () => {
  assert.deepEqual(run("j").steps, ["down"]);
  assert.deepEqual(run("gg").steps, ["pending", "top"]);
  assert.deepEqual(run("gi").steps, ["pending", "input"]);
  assert.deepEqual(run("<A-f>").steps, ["hints"]);
  assert.deepEqual(run("x").steps, ["miss"]);
});

test("matcher: a wrong second key starts over with that key", () => {
  assert.deepEqual(run("gj").steps, ["pending", "down"]);
  assert.deepEqual(run("gx").steps, ["pending", "miss"]);
  assert.deepEqual(run("gx").state.prefix, []);
});

test("matcher: a pending prefix expires", () => {
  const [pending] = feed(keymap, EMPTY_STATE, stroke("g"), 0);
  const [, late] = feed(keymap, pending, stroke("g"), 5000);
  assert.equal(late.kind, "pending");
  const [, inTime] = feed(keymap, pending, stroke("g"), 500);
  assert.equal(inTime.kind, "match");
});

test("matcher: conflicts drop the later binding and say why", () => {
  const conflicted = compileKeymap([
    { sequence: parse("g"), action: "a" },
    { sequence: parse("gg"), action: "b" },
    { sequence: parse("j"), action: "c" },
    { sequence: parse("j"), action: "d" },
    { sequence: parse("xy"), action: "e" },
    { sequence: parse("x"), action: "f" },
  ]);
  assert.deepEqual(
    conflicted.conflicts.map((conflict) => [conflict.dropped.action, conflict.kept.action, conflict.reason]),
    [
      ["b", "a", "prefix"],
      ["d", "c", "duplicate"],
      ["f", "e", "prefix"],
    ],
  );
  assert.deepEqual(
    conflicted.bindings.map((binding) => binding.action),
    ["a", "c", "e"],
  );
});

test("matcher: hint labels fold case, keep the prefix on a miss, and step back", () => {
  const hints = compileKeymap(
    ["sa", "sd", "f"].map((label, action) => ({ sequence: parse(label), action })),
    { foldCase: true, restartOnMiss: false, timeoutMs: Number.POSITIVE_INFINITY },
  );
  let [state, step] = feed(hints, EMPTY_STATE, stroke("S"), 0);
  assert.equal(step.kind, "pending");
  assert.equal(typed(hints, state), "s");
  assert.deepEqual(reachable(hints, state).map((binding) => binding.action).toSorted((a, b) => a - b), [0, 1]);
  [state, step] = feed(hints, state, stroke("x"), 99_999);
  assert.equal(step.kind, "miss");
  assert.equal(typed(hints, state), "s", "a wrong letter does not throw away what was typed");
  state = back(state);
  assert.equal(typed(hints, state), "");
  [state, step] = feed(hints, state, stroke("F"), 0);
  assert.equal(step.kind === "match" ? step.binding.action : undefined, 2);
});

test("matcher: in any prefix-free keymap, typing a binding's sequence matches exactly it", () => {
  const word = fc.array(fc.constantFrom(..."asdfjkl"), { minLength: 1, maxLength: 4 }).map((chars) => chars.join(""));
  fc.assert(
    fc.property(fc.uniqueArray(word, { minLength: 1, maxLength: 40 }), (words) => {
      const compiled = compileKeymap(words.map((sequence) => ({ sequence: parse(sequence), action: sequence })));
      for (const binding of compiled.bindings) {
        let state = EMPTY_STATE;
        let last: string | undefined;
        for (const key of binding.sequence) {
          const [next, step] = feed(compiled, state, key, 0);
          state = next;
          last = step.kind === "match" ? step.binding.action : step.kind;
        }
        assert.equal(last, binding.action);
      }
      // Every kept binding is reachable, and no kept binding is a prefix of another.
      for (const a of compiled.bindings) {
        for (const b of compiled.bindings) {
          if (a !== b) assert.ok(!b.action.startsWith(a.action));
        }
      }
      assert.equal(compiled.bindings.length + compiled.conflicts.length, words.length);
    }),
  );
});
