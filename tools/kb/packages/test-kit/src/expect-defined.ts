/**
 * Test-only narrowing: fail the test when a value the assertion needs is
 * absent. Production code uses `present` in `@kb/model` — that helper throws
 * an invariant error; this one fails the test with a clear message.
 */
export function expectDefined<T>(value: T, message?: string): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error(message ?? "expected a defined value");
  }
  return value;
}
