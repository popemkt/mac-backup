/**
 * The one narrowing helper, for values the type system still calls optional
 * after a construction invariant. Production code and tests share it: it
 * throws, and Effect boundaries fold that through ensureDomainError while a
 * test simply fails with the caller's description.
 */
export function present<T>(value: T | null | undefined, message: string): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}
