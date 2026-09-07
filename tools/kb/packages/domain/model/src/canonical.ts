import { Predicate } from "effect";
import type { KbNode } from "./model.ts";

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

/**
 * The store's file format, from nodes to bytes: one canonical-JSON node per
 * line, sorted by id, trailing newline, empty file for no nodes.
 *
 * This is the only place that shape is written. A second copy — in a test
 * helper, a merge driver, an exporter — is a second format that agrees with
 * this one only until one of them is edited.
 */
export function canonicalJsonl(nodes: readonly KbNode[]): string {
  const sorted = [...nodes].toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sorted.length === 0 ? "" : sorted.map((n) => canonicalJson(n)).join("\n") + "\n";
}
