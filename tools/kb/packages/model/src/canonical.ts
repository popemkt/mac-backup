import { Predicate } from "effect";
/** Deterministic JSON: recursively sort object keys. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!Predicate.isObject(value)) return value;
  const obj = value;
  // `Object.fromEntries`, not a `out[key] = ...` assignment loop: a prop or
  // node key literally named `__proto__` would otherwise set the object's
  // prototype instead of an own key, silently dropping that key's value.
  return Object.fromEntries(
    Object.keys(obj)
      .toSorted()
      .map((key) => [key, sortKeys(obj[key])]),
  );
}
