/** Deterministic JSON: recursively sort object keys. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  // `Object.fromEntries`, not a `out[key] = ...` assignment loop: a prop or
  // node key literally named `__proto__` would otherwise set the object's
  // prototype instead of an own key, silently dropping that key's value.
  return Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((key) => [key, sortKeys(obj[key])]),
  );
}
