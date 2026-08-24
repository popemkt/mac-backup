/**
 * `[[id|label]]` mention extraction (fast-check): src/foundation/query/datascript.ts's
 * extractMentions. Round trip — the ids embedded in a text are exactly the ids
 * extracted, in order, including repeats — and noise that merely resembles the
 * marker (`[`, `]`, `|` in isolation) never becomes a phantom extra mention.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { extractMentions } from "../src/foundation/query/datascript.ts";

/** A mention id: no bracket/pipe chars, so it can never be mistaken for
 * marker syntax or a label boundary. Real ids are ULID/sys.* shaped anyway. */
const idArb = fc.stringMatching(/^[a-zA-Z0-9._-]{1,12}$/);

/** Plain surrounding text with no bracket characters at all, so it cannot
 * combine with a marker or with another fragment to form a phantom mention. */
const cleanFragmentArb = fc.string({ maxLength: 15 }).filter((s) => !/[[\]]/.test(s));

/** Noise that resembles marker syntax without ever completing `[[...]]`:
 * lone brackets/pipes, single/unbalanced brackets, empty. */
const noiseFragmentArb = fc.constantFrom("", "[", "]", "|", "[]", "][", "|]", "[|", "]]", "a[b", "x]y");

function withOptionalLabel(id: string, hasLabel: boolean, label: string): string {
  return hasLabel ? `[[${id}|${label}]]` : `[[${id}]]`;
}

describe("extractMentions properties (fast-check)", () => {
  test("round-trips: extracted ids exactly match the embedded sequence, in order, including repeats", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(idArb, fc.boolean(), fc.string({ maxLength: 8 }).filter((s) => !s.includes("]"))),
          { minLength: 0, maxLength: 20 },
        ),
        fc.array(cleanFragmentArb, { minLength: 21, maxLength: 21 }),
        (mentions, fragments) => {
          let text = fragments[0]!;
          mentions.forEach(([id, hasLabel, label], i) => {
            text += withOptionalLabel(id, hasLabel, label) + fragments[i + 1]!;
          });

          expect(extractMentions(text)).toEqual(mentions.map(([id]) => id));
        },
      ),
      { numRuns: 200 },
    );
  });

  test("marker-like noise never adds, drops, or duplicates a mention", () => {
    fc.assert(
      fc.property(
        fc.array(idArb, { minLength: 0, maxLength: 10 }),
        fc.array(noiseFragmentArb, { minLength: 11, maxLength: 11 }),
        (ids, noise) => {
          let text = noise[0]!;
          ids.forEach((id, i) => {
            text += `[[${id}]]` + noise[i + 1]!;
          });

          expect(extractMentions(text)).toEqual(ids);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("mention ids round-trip with surrounding whitespace trimmed, matching a hand-authored id", () => {
    fc.assert(
      fc.property(idArb, fc.constantFrom(" ", "  ", "\t", ""), (id, pad) => {
        expect(extractMentions(`[[${pad}${id}${pad}]]`)).toEqual([id]);
      }),
      { numRuns: 100 },
    );
  });
});
