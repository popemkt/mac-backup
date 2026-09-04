/**
 * The one owned narrowing helper for values the type system still calls
 * optional after a construction invariant. Throws; Effect boundaries fold
 * that through ensureDomainError.
 */
export function present<T>(value: T | null | undefined, message: string): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}
