import { describe, expect, test } from "bun:test";
import { expectDefined } from "../src/expect-defined.ts";

describe("expectDefined", () => {
  test("returns the value when it is present", () => {
    expect(expectDefined("ok", "missing")).toBe("ok");
    expect(expectDefined(0)).toBe(0);
    expect(expectDefined(false)).toBe(false);
  });

  test("throws when the value is null or undefined", () => {
    expect(() => expectDefined(undefined, "nope")).toThrow("nope");
    expect(() => expectDefined(null)).toThrow("expected a defined value");
  });
});
