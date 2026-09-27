/**
 * The 2D bullets: each node points at its own entry in the bullet table,
 * stands as far as its disc (a halo fills it, a plain leaf's dot fills it),
 * the table is painted again only when some bullet or the page changed, and
 * the program draws from the one GPU form of the bullet (`lib/bullet-gpu`):
 * every shape uniform it declares and sets is `BULLET_UNIFORMS`', and every
 * node's attributes are its `BulletTable` entry. Drawing needs WebGL, as
 * every 2D renderer does (the renderer contract's 2D rows wait on the same
 * gap); the definition and the uniforms it sets do not.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import type { NodeDisplayData, RenderParams } from "sigma/types";
import { BULLET_GEOMETRY, bulletAppearance, bulletExtent } from "@/lib/bullet-mode";
import { BULLET_UNIFORMS, BulletTable, PLAIN_BULLET } from "@/lib/bullet-gpu";
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

describe("the 2D bullets", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  let mod: typeof SigmaBullets;
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
    mod = await import("./sigma-bullets");
  });
  afterAll(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  });

  it("gives each node its entry, and a box that makes its bullet stand as far as its disc", () => {
    const bullets = new mod.SigmaBullets();
    const collapsed = bullet(true, true);
    const [leaf, parent] = bullets.place([undefined, collapsed, PLAIN_BULLET]);
    expect([leaf?.bullet, parent?.bullet]).toEqual([0, 1]);
    const half = BULLET_GEOMETRY.box / 2;
    expect(leaf?.bulletScale).toBeCloseTo(half / bulletExtent(PLAIN_BULLET), 6);
    expect(parent?.bulletScale).toBeCloseTo(half / bulletExtent(collapsed), 6);
    // A halo is larger than a dot: the collapsed parent's box is the tighter one.
    expect(parent?.bulletScale ?? 0).toBeLessThan(leaf?.bulletScale ?? 0);
    expect(bullets.table.distinct).toBe(2);
  });

  it("paints the table again only when a bullet or the page changed", () => {
    const paint = vi.spyOn(BulletTable.prototype, "paintColors");
    const bullets = new mod.SigmaBullets();
    bullets.setPage("#111", "#fff");
    bullets.place([bullet(true, false)]);
    const painted = paint.mock.calls.length;
    const version = bullets.version;
    bullets.place([bullet(true, false)]);
    bullets.setPage("#111", "#fff");
    expect(paint.mock.calls.length).toBe(painted);
    bullets.setPage("#eee", "#111");
    bullets.place([bullet(true, true)]);
    expect(paint.mock.calls.length).toBe(painted + 2);
    expect(bullets.version).toBe(version + 2);
    paint.mockRestore();
  });

  it("draws from the one GPU form: its shape uniforms, and each node's table entry", () => {
    const bullets = new mod.SigmaBullets();
    const collapsed = bullet(true, true);
    const [attrs] = bullets.place([collapsed]);
    const Program = mod.createBulletProgram(bullets);
    const definition = Program.prototype.getDefinition();
    for (const name of Object.keys(BULLET_UNIFORMS)) {
      expect(definition.UNIFORMS).toContain(name);
      expect(definition.FRAGMENT_SHADER_SOURCE).toContain(`uniform vec4 ${name};`);
    }

    // Every shape uniform is set to the description's value.
    const set = new Map<unknown, readonly number[]>();
    const gl = new Proxy(
      { uniform4fv: (at: unknown, value: readonly number[]) => set.set(at, value) },
      { get: (target, key) => (key in target ? target[key as "uniform4fv"] : () => {}) },
    );
    const locations = Object.fromEntries(definition.UNIFORMS.map((name) => [name, name]));
    const upload = { bind: () => {} };
    Program.prototype.setUniforms.call(
      { table: upload, glyphs: upload } as never,
      { width: 100, height: 100, pixelRatio: 1, matrix: new Float32Array(9) } as RenderParams,
      { gl, uniformLocations: locations } as never,
    );
    for (const [name, value] of Object.entries(BULLET_UNIFORMS))
      expect(set.get(name)).toEqual(value);

    // A node's attributes are its table entry, then its box.
    const array = new Float32Array(32);
    Program.prototype.processVisibleItem.call({ array } as never, 0, 0, {
      x: 0,
      y: 0,
      size: 1,
      color: "#000",
      ...attrs,
    } as unknown as NodeDisplayData);
    const { table } = bullets;
    expect([...array.subarray(5, 17)]).toEqual([...table.mark, ...table.paint, ...table.alpha]);
    expect(array[17]).toBeCloseTo(attrs?.bulletScale ?? 0, 6);
  });
});
