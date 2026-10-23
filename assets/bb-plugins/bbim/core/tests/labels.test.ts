// Hint labels: properties over every count and alphabet. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { Result, Schema } from "effect";
import { DEFAULT_ALPHABET, generateLabels, HintAlphabet } from "../src/domain/labels.ts";

const alphabet = fc
  .uniqueArray(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz;'"), { minLength: 2, maxLength: 16 })
  .map((chars) => chars.join(""));
const count = fc.integer({ min: 0, max: 600 });

test("labels: exactly `count` distinct labels", () => {
  fc.assert(
    fc.property(alphabet, count, (letters, n) => {
      const labels = generateLabels(n, letters);
      assert.equal(labels.length, n);
      assert.equal(new Set(labels).size, n);
    }),
  );
});

test("labels: prefix-free, so a label is complete the moment it is typed", () => {
  fc.assert(
    fc.property(alphabet, count, (letters, n) => {
      const labels = generateLabels(n, letters);
      for (const a of labels) {
        for (const b of labels) {
          if (a !== b) assert.ok(!b.startsWith(a), `${a} is a prefix of ${b}`);
        }
      }
    }),
  );
});

test("labels: only the alphabet's letters", () => {
  fc.assert(
    fc.property(alphabet, count, (letters, n) => {
      for (const label of generateLabels(n, letters)) {
        for (const char of label) assert.ok(letters.includes(char));
      }
    }),
  );
});

test("labels: minimal length — every label is k or k+1 letters, k the shortest workable", () => {
  fc.assert(
    fc.property(alphabet, fc.integer({ min: 1, max: 600 }), (letters, n) => {
      const labels = generateLabels(n, letters);
      const size = letters.length;
      // The shortest k with size^k >= n: no prefix-free code fits n words in fewer.
      let k = 1;
      while (size ** k < n) k += 1;
      const lengths = new Set(labels.map((label) => label.length));
      for (const length of lengths) assert.ok(length === k || length === k - 1 || length === k + 1);
      assert.ok(Math.max(...lengths) <= k, `longest label ${Math.max(...lengths)} exceeds ${k}`);
    }),
  );
});

test("labels: shortest first, so the nearest targets get the fewest keystrokes", () => {
  fc.assert(
    fc.property(alphabet, count, (letters, n) => {
      const lengths = generateLabels(n, letters).map((label) => label.length);
      assert.deepEqual(lengths, lengths.toSorted((a, b) => a - b));
    }),
  );
});

test("labels: deterministic", () => {
  fc.assert(
    fc.property(alphabet, count, (letters, n) => {
      assert.deepEqual(generateLabels(n, letters), generateLabels(n, letters));
    }),
  );
});

test("labels: the home row first, then two-letter words", () => {
  const labels = generateLabels(20, DEFAULT_ALPHABET);
  assert.deepEqual(labels.slice(0, 13), [..."sadfjklewcmpg"]);
  assert.deepEqual(labels.slice(13), ["hs", "ha", "hd", "hf", "hj", "hk", "hl"]);
});

test("labels: nothing to label, or no usable alphabet", () => {
  assert.deepEqual(generateLabels(0, DEFAULT_ALPHABET), []);
  assert.deepEqual(generateLabels(5, "a"), []);
});

test("HintAlphabet: rejects repeats (case-insensitively), spaces and single letters", () => {
  const decode = Schema.decodeUnknownResult(HintAlphabet);
  assert.ok(Result.isSuccess(decode("ASDF")));
  for (const bad of ["aA", "a", "as df", 42]) assert.ok(Result.isFailure(decode(bad)), String(bad));
  assert.deepEqual(generateLabels(3, "ASDF"), ["a", "s", "d"], "labels are spelled in lowercase");
});
