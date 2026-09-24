/**
 * The caller's datalog is wrong: the datascript engine rejected the EDN, or
 * the EDN misuses a form kb owns (`reach`). Distinguishes "the datalog is
 * wrong" (invalid_input at the action boundary) from internal glue failures
 * (normalization / revive bugs, which stay plain `Error` → internal).
 */
export class DatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatalogError";
  }
}
