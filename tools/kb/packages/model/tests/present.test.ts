import { describe, expect, test } from "bun:test";
import { present } from "../src/present.ts";

describe("present", () => {
  test("returns the value, including falsy ones", () => {
    expect(present("ok", "a string")).toBe("ok");
    expect(present(0, "a number")).toBe(0);
    expect(present(false, "a boolean")).toBe(false);
  });

  test("throws the caller's description when the value is absent", () => {
    expect(() => present(undefined, "nope")).toThrow("nope");
    expect(() => present(null, "the seeded tag")).toThrow("the seeded tag");
  });
});
