/**
 * The 2D bullets' atlas: each node points at its own cell, stands as far as
 * its disc (a halo fills it, a plain leaf's dot fills it), and the atlas is
 * painted again only when some bullet's paint or the page changed. The GL
 * program itself needs WebGL, as every 2D renderer does (the renderer
 * contract's 2D rows wait on the same gap).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { BULLET_GEOMETRY, bulletAppearance, bulletExtent } from "@/lib/bullet-mode";
import { BulletAtlas, PLAIN_BULLET } from "@/lib/bullet-atlas";
import type * as SigmaBullets from "./sigma-bullets";

const bullet = (hasChildren: boolean, collapsed: boolean) =>
  bulletAppearance({
    hasChildren,
    typeRefs: [],
    tagNames: [],
    isSys: false,
    collapsed,
    childCount: hasChildren ? 2 : 0,
  });

describe("the 2D bullet atlas", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  let SigmaBulletAtlas: typeof SigmaBullets.SigmaBulletAtlas;
  beforeAll(async () => {
    const dom = new Window();
    const globals = {
      window: dom,
      document: dom.document,
      getComputedStyle: dom.getComputedStyle.bind(dom),
      // sigma's programs read the GL enums when their module loads.
      WebGLRenderingContext: { FLOAT: 5126, UNSIGNED_BYTE: 5121, TRIANGLES: 4, POINTS: 0 },
      WebGL2RenderingContext: class {},
    };
    for (const [key, value] of Object.entries(globals)) {
      saved.set(key, g[key]);
      g[key] = value;
    }
    ({ SigmaBulletAtlas } = await import("./sigma-bullets"));
  });
  afterAll(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  });

  it("gives each node its cell, and a box that makes its bullet stand as far as its disc", () => {
    const atlas = new SigmaBulletAtlas();
    const collapsed = bullet(true, true);
    const [leaf, parent, other] = atlas.place([undefined, collapsed, PLAIN_BULLET]);
    expect(leaf?.bulletCell).toBe(other?.bulletCell);
    expect(parent?.bulletCell).not.toBe(leaf?.bulletCell);
    const half = BULLET_GEOMETRY.box / 2;
    expect(leaf?.bulletScale).toBeCloseTo(half / bulletExtent(PLAIN_BULLET), 6);
    expect(parent?.bulletScale).toBeCloseTo(half / bulletExtent(collapsed), 6);
    // A halo is larger than a dot: the collapsed parent's box is the tighter one.
    expect(parent?.bulletScale ?? 0).toBeLessThan(leaf?.bulletScale ?? 0);
  });

  it("paints again only when a bullet's paint or the page changed", () => {
    const paint = vi.spyOn(BulletAtlas.prototype, "paint");
    const atlas = new SigmaBulletAtlas();
    atlas.setPage("#111", "#fff");
    atlas.place([bullet(true, false)]);
    const painted = paint.mock.calls.length;
    const version = atlas.version;
    atlas.place([bullet(true, false)]);
    atlas.setPage("#111", "#fff");
    expect(paint.mock.calls.length).toBe(painted);
    atlas.setPage("#eee", "#111");
    atlas.place([bullet(true, true)]);
    expect(paint.mock.calls.length).toBe(painted + 2);
    expect(atlas.version).toBe(version + 2);
    paint.mockRestore();
  });
});
