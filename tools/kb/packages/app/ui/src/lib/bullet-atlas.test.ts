/**
 * A graph's bullet atlas holds each distinct bullet once, and every node
 * points at its own cell — the layout both graph renderers sample.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { bulletAppearance } from "./bullet-mode";
import { BulletAtlas, bulletAtlasKey, PLAIN_BULLET } from "./bullet-atlas";

const bullet = (hasChildren: boolean, collapsed: boolean, tagColors: string[] = []) =>
  bulletAppearance({
    hasChildren,
    typeRefs: [],
    tagNames: [],
    isSys: false,
    collapsed,
    childCount: hasChildren ? 2 : 0,
    tagColors,
  });

describe("the bullet atlas", () => {
  const g = globalThis as Record<string, unknown>;
  let saved: unknown;
  beforeAll(() => {
    saved = g.document;
    g.document = new Window().document;
  });
  afterAll(() => {
    if (saved === undefined) delete g.document;
    else g.document = saved;
  });

  it("paints each distinct bullet once, and each node points at its own cell", () => {
    const parent = bullet(true, true, ["red"]);
    const atlas = new BulletAtlas([undefined, parent, PLAIN_BULLET, parent]);
    expect(atlas.cells).toBe(2);
    expect([...atlas.cellOf]).toEqual([0, 1, 0, 1]);
    // Cell 0 is the canvas's top-left; cell 1 stands right of it on the same row.
    const [x0, y0, w, h] = atlas.cell(0);
    const [x1, y1] = atlas.cell(1);
    expect(x0).toBeGreaterThan(0);
    expect(y0).toBeGreaterThan(0);
    expect(y0 + h).toBeLessThan(1);
    expect(x1).toBeGreaterThan(x0 + w);
    expect(y1).toBe(y0);
  });

  it("keys a graph by its bullets: a node without one is a plain leaf", () => {
    expect(bulletAtlasKey([undefined])).toBe(bulletAtlasKey([PLAIN_BULLET]));
    expect(bulletAtlasKey([bullet(true, false)])).not.toBe(bulletAtlasKey([bullet(true, true)]));
  });
});
