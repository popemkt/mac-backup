/**
 * The canvas renderer of a bullet draws what the one definition says
 * (`bullet-mode`): the same parts at the same sizes, in the same paints. A
 * recording context stands in for a canvas, so what is checked is every
 * shape the painter lays and the colour it lays it in.
 */
import { describe, expect, it } from "vitest";
import {
  BULLET_GEOMETRY,
  bulletAppearance,
  bulletRingDash,
  type BulletAppearanceInput,
} from "./bullet-mode";
import { bulletPaintKey, paintBullet, type BulletPage } from "./bullet-paint";
import { SYSTEM_IDS } from "./types";

interface Mark {
  readonly kind: "arc" | "text" | "stroke";
  readonly size: number | string;
  readonly fill: unknown;
  readonly alpha: number;
}

function recorder() {
  const marks: Mark[] = [];
  let pending: { kind: "arc"; size: number } | null = null;
  let scale = 1;
  const ctx = {
    fillStyle: "" as unknown,
    strokeStyle: "" as unknown,
    globalAlpha: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    lineWidth: 1,
    save() {},
    restore() {},
    translate() {},
    scale(x: number) {
      scale *= x;
    },
    beginPath() {},
    setLineDash() {},
    stroke() {
      if (pending)
        marks.push({
          kind: "stroke",
          size: pending.size,
          fill: ctx.strokeStyle,
          alpha: ctx.globalAlpha,
        });
    },
    arc(_x: number, _y: number, r: number) {
      pending = { kind: "arc", size: r };
    },
    fill() {
      if (pending) marks.push({ ...pending, fill: ctx.fillStyle, alpha: ctx.globalAlpha });
    },
    fillText(text: string) {
      marks.push({ kind: "text", size: text, fill: ctx.fillStyle, alpha: ctx.globalAlpha });
    },
    createConicGradient: () => ({ addColorStop() {} }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, marks, scale: () => scale };
}

const PAGE: BulletPage = {
  ink: "rgb(20, 20, 20)",
  ground: "rgb(250, 250, 250)",
  face: "x",
  glyphSize: 11,
};
const appear = (partial: Partial<BulletAppearanceInput>) =>
  bulletAppearance({
    hasChildren: false,
    typeRefs: [],
    tagNames: [],
    isSys: false,
    collapsed: true,
    childCount: 0,
    ...partial,
  });

describe("paintBullet draws the bullet definition", () => {
  it("a collapsed parent: the halo, then the parent dot, each over the ground once", () => {
    const { ctx, marks } = recorder();
    const a = appear({ hasChildren: true, childCount: 2, tagColors: ["red"] });
    paintBullet(ctx, a, { x: 0, y: 0, size: BULLET_GEOMETRY.box }, PAGE);
    const halo = BULLET_GEOMETRY.box / 2 - BULLET_GEOMETRY.haloInset;
    expect(marks).toEqual([
      { kind: "arc", size: halo, fill: PAGE.ground, alpha: 1 },
      { kind: "arc", size: halo, fill: "red", alpha: 0.125 },
      { kind: "arc", size: BULLET_GEOMETRY.dot.parent / 2, fill: "red", alpha: 1 },
    ]);
  });

  it("an untinted leaf: its dot in the page's ink at the definition's strength", () => {
    const { ctx, marks } = recorder();
    paintBullet(ctx, appear({}), { x: 0, y: 0, size: BULLET_GEOMETRY.box }, PAGE);
    expect(marks).toEqual([
      { kind: "arc", size: BULLET_GEOMETRY.dot.leaf / 2, fill: PAGE.ground, alpha: 1 },
      { kind: "arc", size: BULLET_GEOMETRY.dot.leaf / 2, fill: PAGE.ink, alpha: 0.4 },
    ]);
  });

  it("a kind glyph is set in the ink, a sys node at half strength", () => {
    const { ctx, marks } = recorder();
    const a = appear({ typeRefs: [SYSTEM_IDS.field], isSys: true });
    paintBullet(ctx, a, { x: 0, y: 0, size: BULLET_GEOMETRY.box }, PAGE);
    expect(marks.at(-1)).toEqual({
      kind: "text",
      size: a.glyph,
      fill: PAGE.ink,
      alpha: 0.45 * 0.5,
    });
  });

  it("a supertag draws the record's glyph, as every glyph shape does", () => {
    for (const a of [
      appear({ typeRefs: [SYSTEM_IDS.tag] }),
      appear({ typeRefs: [SYSTEM_IDS.command] }),
    ]) {
      const { ctx, marks } = recorder();
      paintBullet(ctx, a, { x: 0, y: 0, size: BULLET_GEOMETRY.box }, PAGE);
      expect(a.glyph).not.toBeNull();
      expect(marks.filter((m) => m.kind === "text").map((m) => m.size)).toEqual([a.glyph, a.glyph]);
    }
  });

  it("a collapsed reference ring strokes over its halo, not over a ground dash", () => {
    const ring = bulletRingDash().radius;
    const { ctx, marks } = recorder();
    const a = appear({ hasChildren: true, childCount: 2, isRef: true, tagColors: ["red"] });
    expect(a.shape).toBe("ref-ring");
    expect(a.showHalo).toBe(true);
    paintBullet(ctx, a, { x: 0, y: 0, size: BULLET_GEOMETRY.box }, PAGE);
    const strokes = marks.filter((m) => m.kind === "stroke");
    expect(strokes).toEqual([{ kind: "stroke", size: ring, fill: "red", alpha: 0.25 }]);
    // Nothing after the halo is laid on the ground: the dot sits on the halo too.
    expect(marks.slice(2).some((m) => m.fill === PAGE.ground)).toBe(false);
  });

  it("an open reference ring, with nothing under it, strokes over the ground first", () => {
    const ring = bulletRingDash().radius;
    const { ctx, marks } = recorder();
    const a = appear({ isRef: true, collapsed: false, tagColors: ["red"] });
    expect(a.showHalo).toBe(false);
    paintBullet(ctx, a, { x: 0, y: 0, size: BULLET_GEOMETRY.box }, PAGE);
    expect(marks.filter((m) => m.kind === "stroke")).toEqual([
      { kind: "stroke", size: ring, fill: PAGE.ground, alpha: 1 },
      { kind: "stroke", size: ring, fill: "red", alpha: 0.25 },
    ]);
  });

  it("scales the 24px box to the cell it is painted into", () => {
    const { ctx, scale } = recorder();
    paintBullet(ctx, appear({}), { x: 0, y: 0, size: 96 }, PAGE);
    expect(scale()).toBe(96 / BULLET_GEOMETRY.box);
  });

  it("keys two bullets alike exactly when they paint alike", () => {
    expect(bulletPaintKey(appear({ tagColors: ["red"] }))).toBe(
      bulletPaintKey(appear({ tagColors: ["red"], text: "another" })),
    );
    expect(bulletPaintKey(appear({ tagColors: ["red"] }))).not.toBe(
      bulletPaintKey(appear({ tagColors: ["blue"] })),
    );
  });
});
