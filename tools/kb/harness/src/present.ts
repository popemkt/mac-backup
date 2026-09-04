/**
 * The harness's own narrowing helper.
 *
 * `@kb/model` exports the same two lines, and this is deliberately not that
 * one: the harness checks the workspace from outside it, so a harness file
 * importing product code would make the checker a member of the thing it
 * checks — the `harness imports no product code` case in `boundaries` is the
 * gate that says so.
 */
export function present<T>(value: T | null | undefined, message: string): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}
