/**
 * The GPU form of the bullet (`lib/bullet-gpu`) is the one description
 * (`lib/bullet-mode`) in a shader's terms: the shape's uniforms are its
 * geometry in px of the box, each node's entry is its appearance's mark,
 * radii, colours and strengths, and a glyph's distance field keeps its edge.
 * Both graph renderers draw from exactly this (`sigma-bullets`,
 * `force3d-bullets`), as the outline's `Bullet` draws from the description.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import {
  BULLET_GEOMETRY,
  BULLET_GLYPHS,
  BULLET_HALO_RADIUS,
  BULLET_INK,
  BULLET_QUERY_ICON,
  BULLET_SYS_OPACITY,
  bulletAppearance,
  bulletRingDash,
  queryHandleStart,
  SYSTEM_IDS,
  type BulletAppearanceInput,
} from "@kb/ui-sdk";
import {
  BULLET_MARKS,
  BULLET_TABLE_COLUMNS,
  BULLET_UNIFORMS,
  BulletTable,
  bulletKey,
  bulletTableKey,
  PLAIN_BULLET,
  signedDistanceField,
} from "./bullet-gpu";

const appear = (partial: Partial<BulletAppearanceInput> = {}) =>
  bulletAppearance({
    hasChildren: false,
    typeRefs: [],
    tagNames: [],
    isSys: false,
    collapsed: false,
    childCount: 0,
    ...partial,
  });

const entry = (table: BulletTable, i: number) => ({
  mark: [...table.mark.subarray(i * 4, i * 4 + 4)],
  paint: [...table.paint.subarray(i * 4, i * 4 + 4)],
  alpha: [...table.alpha.subarray(i * 4, i * 4 + 4)],
});

describe("the shape's uniforms are the description's geometry, px of the box", () => {
  const icon = BULLET_GEOMETRY.icon / BULLET_QUERY_ICON.viewBox;
  const inBox = (v: number) => (v - BULLET_QUERY_ICON.viewBox / 2) * icon;

  it("the ring: its centre line, half its stroke, and its fitted dash period", () => {
    const dash = bulletRingDash();
    expect(BULLET_UNIFORMS.u_bulletRing).toEqual([
      dash.radius,
      BULLET_GEOMETRY.ring.stroke / 2,
      dash.dash + dash.gap,
      dash.dash,
    ]);
  });

  it("the magnifier: its lens and handle, the icon drawn at the box's centre", () => {
    const { lens, handle, stroke } = BULLET_QUERY_ICON;
    expect(BULLET_UNIFORMS.u_bulletLens).toEqual([
      inBox(lens.x),
      inBox(lens.y),
      lens.radius * icon,
      (stroke / 2) * icon,
    ]);
    const from = queryHandleStart();
    expect(BULLET_UNIFORMS.u_bulletHandle).toEqual([
      inBox(from.x),
      inBox(from.y),
      inBox(handle.x),
      inBox(handle.y),
    ]);
  });

  it("the glyphs: one cell per kind glyph, each spanning the box", () => {
    expect(BULLET_UNIFORMS.u_bulletGlyph[0]).toBe(BULLET_GLYPHS.length);
    expect(BULLET_UNIFORMS.u_bulletGlyph[2]).toBe(BULLET_GEOMETRY.box);
  });
});

describe("a node's entry is its appearance", () => {
  it("a collapsed parent: the halo at its radius, the parent dot, both in their paints", () => {
    const a = appear({ hasChildren: true, childCount: 2, collapsed: true, tagColors: ["red"] });
    const table = new BulletTable([a]);
    expect(entry(table, 0)).toEqual({
      mark: [BULLET_MARKS.dot, BULLET_HALO_RADIUS, BULLET_GEOMETRY.dot.parent / 2, -1],
      paint: [0, 0, 1, 1],
      alpha: [a.halo.percent / 100, 1, 1, a.ring.percent / 100],
    });
  });

  it("an open leaf has no halo; a plain leaf stands for a node without a bullet", () => {
    const table = new BulletTable([undefined, PLAIN_BULLET]);
    expect(entry(table, 0)).toEqual(entry(table, 1));
    expect(entry(table, 0).mark).toEqual([BULLET_MARKS.dot, 0, BULLET_GEOMETRY.dot.leaf / 2, -1]);
    expect(table.distinct).toBe(1);
  });

  it("a reference ring keeps its dot; a query node and a glyph draw no dot", () => {
    const [ring, query, field, supertag] = [
      appear({ isRef: true }),
      appear({ fieldIds: [SYSTEM_IDS.queryField] }),
      appear({ typeRefs: [SYSTEM_IDS.field] }),
      appear({ typeRefs: [SYSTEM_IDS.tag] }),
    ];
    const table = new BulletTable([ring, query, field, supertag]);
    expect(entry(table, 0).mark).toEqual([BULLET_MARKS.ring, 0, ring.dotSize / 2, -1]);
    expect(entry(table, 1).mark.slice(0, 3)).toEqual([BULLET_MARKS.magnifier, 0, 0]);
    expect(entry(table, 2).mark).toEqual([
      BULLET_MARKS.glyph,
      0,
      0,
      BULLET_GLYPHS.indexOf(field.glyph ?? ""),
    ]);
    expect(entry(table, 3).mark[3]).toBe(BULLET_GLYPHS.indexOf("#"));
  });

  it("a many-tagged bullet divides its halo and dot into every tag's wedge", () => {
    const a = appear({
      hasChildren: true,
      childCount: 1,
      collapsed: true,
      tagColors: ["red", "green", "blue"],
    });
    expect(entry(new BulletTable([a]), 0).paint).toEqual([0, 0, 3, 3]);
  });

  it("a sys node is drawn at the stated opacity on every surface", () => {
    const a = appear({ isSys: true, typeRefs: [SYSTEM_IDS.field] });
    const { alpha } = entry(new BulletTable([a]), 0);
    expect(alpha[2]).toBeCloseTo((a.ink.percent / 100) * BULLET_SYS_OPACITY, 6);
  });

  it("each distinct bullet is one row, and rows run on past the tallest table", () => {
    const many = Array.from({ length: 4100 }, (_, i) =>
      appear({ tagColors: [`rgb(${i % 256}, ${Math.floor(i / 256)}, 0)`] }),
    );
    const table = new BulletTable([...many, many[0]]);
    expect(table.distinct).toBe(4100);
    expect(table.height).toBe(4096);
    // The last rows sit in a second column group; a repeated bullet shares its row.
    const last = entry(table, 4099).paint;
    expect(last[0]).toBeGreaterThan(0);
    expect(last[1]).toBe(3);
    expect(entry(table, 4100).paint).toEqual(entry(table, 0).paint);
  });

  it("keys two bullets alike exactly when they draw alike", () => {
    expect(bulletKey(appear({ tagColors: ["red"] }))).toBe(
      bulletKey(appear({ tagColors: ["red"], text: "another" })),
    );
    expect(bulletKey(appear({ tagColors: ["red"] }))).not.toBe(
      bulletKey(appear({ tagColors: ["blue"] })),
    );
    expect(bulletTableKey([undefined])).toBe(bulletTableKey([PLAIN_BULLET]));
  });
});

describe("the colour table", () => {
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

  it("lays each row as ground, ink, ring, then the halo's and dot's colours, the ink resolved", () => {
    const texels: [number, number, string][] = [];
    const ctx = {
      fillStyle: "",
      clearRect() {},
      fillRect(x: number, y: number) {
        texels.push([x, y, ctx.fillStyle]);
      },
    };
    const canvas = { width: 0, height: 0, getContext: () => ctx };
    const a = appear({
      hasChildren: true,
      childCount: 1,
      collapsed: true,
      tagColors: ["red", "blue"],
    });
    const table = new BulletTable([PLAIN_BULLET, a]);
    table.paintColors(canvas as unknown as HTMLCanvasElement, { ink: "#111", ground: "#fff" });
    expect([canvas.width, canvas.height]).toEqual([table.width, table.height]);
    const row = (y: number) => texels.filter((t) => t[1] === y).map((t) => t[2]);
    expect(row(0)).toEqual(["#fff", "#111", "#111", "#111", "#111"]);
    expect(row(1)).toEqual(["#fff", "red", "red", "red", "blue", "red", "blue"]);
    expect(BULLET_TABLE_COLUMNS.halo).toBe(3);
    expect(PLAIN_BULLET.ink.colors).toEqual([BULLET_INK]);
  });
});

describe("a glyph's distance field", () => {
  it("reads back each pixel's distance to the edge, within a pixel, out to the spread", () => {
    const side = 64;
    const radius = 12;
    const spread = 8;
    const distance = (x: number, y: number) =>
      Math.hypot(x + 0.5 - side / 2, y + 0.5 - side / 2) - radius;
    const coverage = new Float32Array(side * side);
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++)
        coverage[y * side + x] = Math.min(1, Math.max(0, 0.5 - distance(x, y)));
    const field = signedDistanceField(coverage, side, side, spread);
    const at = (x: number, y: number) => field[y * side + x] ?? Number.NaN;
    // What a shader reads back: the distance, px, from the field.
    const read = (x: number, y: number) => (0.5 - at(x, y)) * 2 * spread;
    for (let x = side / 2 + radius - 6; x <= side / 2 + radius + 6; x++)
      expect(Math.abs(read(x, side / 2) - distance(x, side / 2))).toBeLessThanOrEqual(1);
    expect(at(side / 2, side / 2)).toBe(1);
    expect(at(0, 0)).toBe(0);
  });
});
