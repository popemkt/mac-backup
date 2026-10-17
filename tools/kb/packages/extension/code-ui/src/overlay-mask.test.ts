/**
 * The overlay mask hides each region a view takes gestures in: a box as a
 * rectangle, a line as a stroke as wide as the region says.
 */
import { describe, expect, test } from "vitest";
import { overlayMask } from "./overlay-mask";

const svgOf = (mask: string) =>
  decodeURIComponent(mask.replace(/^url\("data:image\/svg\+xml,/, "").replace(/"\)$/, ""));

describe("the overlay mask", () => {
  test("shows the whole layer when the view names no region", () => {
    const svg = svgOf(overlayMask([], 200, 100));
    expect(svg).toContain("<rect width='200.0' height='100.0' fill='white'/>");
    expect(svg).not.toContain("black");
  });

  test("hides each box and each line, at its place and width", () => {
    const svg = svgOf(
      overlayMask(
        [
          { box: { left: 10, top: 20, right: 60, bottom: 50 } },
          {
            line: [
              { x: 0, y: 0 },
              { x: 30, y: 40 },
            ],
            width: 16,
          },
        ],
        200,
        100,
      ),
    );
    expect(svg).toContain("<rect x='10.0' y='20.0' width='50.0' height='30.0' fill='black'/>");
    expect(svg).toContain(
      "<polyline points='0.0,0.0 30.0,40.0' fill='none' stroke='black' stroke-width='16.0'",
    );
  });
});
