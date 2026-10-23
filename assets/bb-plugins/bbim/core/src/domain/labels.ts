// Hint labels: prefix-free words over a home-row alphabet, shortest first.
import { Schema } from "effect";

export const DEFAULT_ALPHABET = "sadfjklewcmpgh";

/**
 * An alphabet hint labels are spelled in: at least two distinct, non-space
 * characters. Labels are typed case-insensitively, so `a` and `A` are one
 * letter, and labels are spelled in lowercase whatever the alphabet's case.
 */
export const HintAlphabet = Schema.String.check(
  Schema.makeFilter((value: string) => {
    const chars = [...value.toLowerCase()];
    if (chars.length < 2) return "needs at least two characters";
    if (chars.some((char) => /\s/u.test(char))) return "must not contain spaces";
    if (new Set(chars).size !== chars.length) return "must not repeat a character (case-insensitively)";
    return undefined;
  }),
);

function words(chars: ReadonlyArray<string>, length: number): Array<string> {
  let level = [""];
  for (let depth = 0; depth < length; depth += 1) level = level.flatMap((word) => chars.map((char) => word + char));
  return level;
}

/**
 * `count` distinct labels over `alphabet`, no label a prefix of another, the
 * shortest ones first. With k the smallest length whose words could number
 * `count`, labels are words of length k-1 and k: as many short ones as still
 * leave room, and the rest spelled under the last few short words. The first
 * letters of the alphabet (the strongest keys) stay single keystrokes; its
 * last letters become the prefixes of the longer labels.
 */
export function generateLabels(count: number, alphabet: string): ReadonlyArray<string> {
  const chars = [...new Set(alphabet.toLowerCase())];
  const size = chars.length;
  if (count <= 0 || size < 2) return [];
  let k = 1;
  while (size ** k < count) k += 1;
  if (k === 1) return chars.slice(0, count);
  const shorter = words(chars, k - 1);
  // Expanding one shorter word trades it for `size` longer ones: a net gain of size - 1.
  const expanded = Math.min(shorter.length, Math.ceil((count - shorter.length) / (size - 1)));
  const kept = shorter.slice(0, shorter.length - expanded);
  const longer = shorter.slice(shorter.length - expanded).flatMap((word) => chars.map((char) => word + char));
  return [...kept, ...longer].slice(0, count);
}
