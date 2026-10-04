import { afterEach, describe, expect, it } from "vitest";
import { prefersReducedMotion } from "./motion";

const g = globalThis as Record<string, unknown>;

describe("prefersReducedMotion", () => {
  afterEach(() => {
    delete g.window;
  });

  it("is false with no window or no matchMedia", () => {
    expect(prefersReducedMotion()).toBe(false);
    g.window = {};
    expect(prefersReducedMotion()).toBe(false);
  });

  it("reads the media query", () => {
    const asked: string[] = [];
    g.window = {
      matchMedia: (query: string) => {
        asked.push(query);
        return { matches: true };
      },
    };
    expect(prefersReducedMotion()).toBe(true);
    expect(asked).toEqual(["(prefers-reduced-motion: reduce)"]);
  });
});
