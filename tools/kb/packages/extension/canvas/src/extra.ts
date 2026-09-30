/**
 * Unknown fields, kept for round-trip on anything that carries them. When kb
 * writes a field it could not read before, the value it writes supersedes
 * the unreadable one.
 */
export interface WithExtra {
  extra?: Record<string, unknown>;
}

/** `value` without the unknown field `key` (the same object when it has none). */
export function dropExtra<T extends WithExtra>(value: T, key: string): T {
  if (value.extra === undefined || !(key in value.extra)) return value;
  const rest = Object.fromEntries(Object.entries(value.extra).filter(([k]) => k !== key));
  const next = { ...value };
  if (Object.keys(rest).length > 0) next.extra = rest;
  else delete next.extra;
  return next;
}
