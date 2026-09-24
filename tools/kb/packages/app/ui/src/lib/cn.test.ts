import { describe, expect, it } from "vitest";
import { cn, TYPE_STEPS } from "./cn";

describe("cn knows the design system's scales", () => {
  it("a type step is a font size, not a colour", () => {
    for (const step of TYPE_STEPS) {
      expect(cn(`text-${step}`, "text-foreground/50")).toBe(`text-${step} text-foreground/50`);
    }
  });

  it("a later type step replaces an earlier one", () => {
    expect(cn("text-label", "text-meta")).toBe("text-meta");
  });
});
