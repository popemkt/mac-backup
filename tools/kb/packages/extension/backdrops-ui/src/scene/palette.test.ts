import { describe, expect, it } from "vitest";
import { lightness, mix, paletteOf, parseRgb, type SceneTokens } from "./palette";

const NIGHT: SceneTokens = {
  background: { r: 20, g: 20, b: 22 },
  foreground: { r: 245, g: 245, b: 245 },
  primary: { r: 240, g: 170, b: 60 },
  sun: { r: 247, g: 201, b: 72 },
};
const DAY: SceneTokens = {
  background: { r: 252, g: 252, b: 250 },
  foreground: { r: 30, g: 30, b: 30 },
  primary: { r: 160, g: 100, b: 20 },
  sun: { r: 247, g: 201, b: 72 },
};

describe("paletteOf", () => {
  it("fills every actor with the page's own tone: the silhouette trick", () => {
    expect(paletteOf(NIGHT, null, true).body).toEqual(NIGHT.background);
    expect(paletteOf(DAY, null, false).body).toEqual(DAY.background);
  });

  it("a moon is lighter than the night it hangs in, a sun is warmer than the day", () => {
    const night = paletteOf(NIGHT, null, true);
    expect(lightness(night.core)).toBeGreaterThan(lightness(night.body) + 0.5);
    const day = paletteOf(DAY, null, false);
    expect(day.core.r).toBeGreaterThan(day.core.b + 40);
    expect(lightness(day.core)).toBeLessThan(lightness(day.body));
  });

  it("is lit toward the head's colour", () => {
    const blue = { r: 40, g: 80, b: 255 };
    const plain = paletteOf(NIGHT, null, true);
    const tinted = paletteOf(NIGHT, blue, true);
    expect(tinted.halo.b - tinted.halo.r).toBeGreaterThan(plain.halo.b - plain.halo.r);
  });

  it("gives a bat warm eyes, brighter at the glint", () => {
    const { eye, eyeHot } = paletteOf(NIGHT, null, true);
    expect(eye.r).toBeGreaterThan(eye.b);
    expect(lightness(eyeHot)).toBeGreaterThan(lightness(eye));
  });
});

describe("colour helpers", () => {
  it("mixes and parses", () => {
    expect(mix({ r: 0, g: 0, b: 0 }, { r: 100, g: 200, b: 50 }, 0.5)).toEqual({
      r: 50,
      g: 100,
      b: 25,
    });
    expect(parseRgb("rgba(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseRgb("nope")).toBeNull();
  });
});
