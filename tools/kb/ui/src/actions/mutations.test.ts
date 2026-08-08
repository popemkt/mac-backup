import { describe, expect, it } from "vitest";
import { mutations } from "./mutations";

describe("U3 seams", () => {
  it("mutation stubs throw not wired", () => {
    expect(() => mutations.createNodeAfter("x")).toThrow(/not wired/);
    expect(() => mutations.updateNodeContent("x", "y")).toThrow(/not wired/);
  });
});
